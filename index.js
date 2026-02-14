import express from "express";
import cors from "cors";
import { MongoClient, ObjectId, ServerApiVersion } from "mongodb";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import Stripe from "stripe";
dotenv.config();

const port = process.env.PORT || 3000;
const app = express();

// middleware
app.use(
  cors({
    origin: [
      "http://localhost:5173",
    ],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).send({ message: "Unauthorized" });
  }

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) return res.status(403).send({ message: "Forbidden" });
    req.decoded = decoded;
    next();
  });
};

const stripe = new Stripe(process.env.STRIPE_SK);

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@clusterhub.3pf2lfb.mongodb.net/?appName=ClusterHub`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {

    // Connections
    const database = client.db(process.env.DB_NAME);
    const usersCollection = database.collection("users");
    const clubsCollection = database.collection("clubs");
    const appsCollection = database.collection("applications");
    const reviewsCollection = database.collection("reviews");
    const paymentsCollection = database.collection("payments");

    // jwt
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "none",
          maxAge: 60 * 60 * 1000,
        })
        .send({ success: true });
    });
    // Delete JWT
    app.post("/logout", async (req, res) => {
      res
        .clearCookie("token", {
          httpOnly: true,
          secure: true,
          sameSite: "none",
        })
        .send({ success: true });
    });

    // admin or moderator middleware
    const verifyAdmin = async (req, res, next) => {
      try {
        const email = req.decoded?.email;
        if (!email) {
          return res.status(401).send({ message: "Unauthorized" });
        }

        const user = await usersCollection.findOne({ email });
        if (!user || user.role !== "Admin") {
          return res.status(403).send({ message: "Forbidden: Admin only" });
        }

        next();
      } catch (error) {
        res.status(500).send({ message: "Server error" });
      }
    };

    const verifyModerator = async (req, res, next) => {
      try {
        const email = req.decoded?.email;
        if (!email) {
          return res.status(401).send({ message: "Unauthorized" });
        }

        const user = await usersCollection.findOne({ email });
        if (!user || (user.role !== "Moderator" && user.role !== "Admin")) {
          return res.status(403).send({ message: "Forbidden: Moderator only" });
        }

        next();
      } catch (error) {
        res.status(500).send({ message: "Server error" });
      }
    };

    // GET All Users
    app.get("/users", async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });
    // GET Single User by Email
    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      res.send(result);
    });
    // CREATE New User
    app.post("/users", async (req, res) => {
      const newUser = req.body;
      const exists = await usersCollection.findOne({ email: newUser.email });

      if (exists) {
        return res.status(409).send({ message: "User already exists" });
      }

      const result = await usersCollection.insertOne(newUser);
      res.send(result);
    });
    // Update user role
    app.put("/users/:userId/role", async (req, res) => {
      try {
        const { userId } = req.params;
        const { role } = req.body;

        // Validate role
        const validRoles = ["Student", "Moderator"];
        if (!validRoles.includes(role)) {
          return res.status(400).send({ message: "Invalid role value" });
        }

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $set: { role } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "User not found" });
        }

        res.send({ success: true, message: "Role updated successfully" });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error" });
      }
    });
    // Assign moderator
    app.put("/users/assign/:email", async (req, res) => {
      try {
        const { email } = req.params;
        const { moderatorFor } = req.body;

        const result = await usersCollection.updateOne(
          { email },
          { $set: { moderatorFor } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "User not found" });
        }

        res.send({ success: true, message: "Moderator assigned successfully" });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error" });
      }
    });
    // DELETE user
    app.delete("/users/:id", async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid user ID" });
        }

        const result = await usersCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "User not found" });
        }

        res.send({ success: true, deleted: result.deletedCount });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error deleting user" });
      }
    });

    // GET all Clubs (search + filter + sort + pagination)
    app.get("/clubs", async (req, res) => {
      try {
        const {
          search,
          category,
          sortBy,
          order,
          page = 1,
          limit = 9,
        } = req.query;

        let query = {};
        let sortOption = {};

        if (search) {
          query.$or = [
            { scholarshipName: { $regex: search, $options: "i" } },
            { universityName: { $regex: search, $options: "i" } },
            { universityCountry: { $regex: search, $options: "i" } },
          ];
        }

        if (category) {
          query.scholarshipCategory = category;
        }

        if (sortBy) {
          const sortOrder = order === "asc" ? 1 : -1;
          if (sortBy === "fees") sortOption.applicationFees = sortOrder;
          if (sortBy === "date") sortOption.postedDate = sortOrder;
        }

        const skip = (Number(page) - 1) * Number(limit);

        const total = await clubsCollection.countDocuments(query);

        const clubs = await clubsCollection
          .find(query)
          .sort(sortOption)
          .skip(skip)
          .limit(Number(limit))
          .toArray();

        res.send({
          data: clubs,
          total,
          page: Number(page),
          totalPages: Math.ceil(total / limit),
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // GET Recommended Clubs
    app.get("/rec/clubs", async (req, res) => {
      try {
        const { category, currentId } = req.query;

        if (!category) {
          return res
            .status(400)
            .send({ message: "Category is required for recommendations" });
        }

        let query = { subjectCategory: category };

        if (currentId) {
          query._id = { $ne: new ObjectId(currentId) };
        }

        const result = await clubsCollection
          .find(query)
          .limit(4)
          .toArray();

        res.send(result);
      } catch (error) {
        console.error("Rec API Error:", error);
        res.status(500).send({ message: "Failed to fetch recommendations" });
      }
    });

    // GET home clubs
    app.get("/home/clubs", async (req, res) => {
      const result = await clubsCollection.find({}).limit(6).toArray();
      res.send(result);
    });
    // GET admin clubs
    app.get("/clubs/:admin", async (req, res) => {
      const adminEmail = req.params.admin;

      const result = await clubsCollection
        .find({ postedUserEmail: adminEmail })
        .toArray();
      res.send(result);
    });
    // POST clubs
    app.post("/clubs", async (req, res) => {
      const data = req.body;
      const result = await clubsCollection.insertOne(data);
      res.send(result);
    });
    // DELETE clubs
    app.delete("/clubs/delete/:id", async (req, res) => {
      try {
        const id = req.params.id;

        // Optional: verify that the user deleting this scholarship is the owner/admin
        const scholarship = await clubsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!scholarship)
          return res.status(404).send({ message: "Scholarship not found" });

        const result = await clubsCollection.deleteOne({
          _id: new ObjectId(id),
        });
        if (result.deletedCount > 0) {
          res.send({ success: true, deletedCount: result.deletedCount });
        } else {
          res.status(400).send({ success: false, message: "Delete failed" });
        }
      } catch (error) {
        console.error(error);
        res.status(500).send({ success: false, message: "Server error" });
      }
    });

    // GET admin scholarship data
    app.get("/scholarship/data/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const result = await clubsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!result) {
          return res.status(404).send({ message: "No scholarship found" });
        }

        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server error" });
      }
    });
    // UPDATE admin scholarship data
    app.put("/scholarship/update/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const data = req.body;

        const result = await clubsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: data }
        );

        if (result.modifiedCount === 0) {
          return res.status(400).send({ message: "No changes made" });
        }

        res.send({ success: true, message: "Updated successfully" });
      } catch (error) {
        res.status(500).send({ message: "Server error" });
      }
    });

    // GET reviews filtered by scholarshipId
    app.get("/reviews", async (req, res) => {
      try {
        const scholarshipId = req.query.scholarshipId;
        const email = req.query.email;
        const modMail = req.query.modMail;

        let query = {};

        if (scholarshipId) {
          query.scholarshipId = scholarshipId;
        }

        if (email) {
          query.userEmail = email;
        }

        if (modMail) {
          query.postByEmail = modMail;
        }

        const result = await reviewsCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error" });
      }
    });
    // Delete Review
    app.delete("/reviews/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const result = await reviewsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "Review not found" });
        }

        res.send({ success: true });
      } catch (error) {
        res.status(500).send({ message: "Server error deleting review" });
      }
    });

    // CREATE Application
    app.post("/applications", async (req, res) => {
      try {
        const {
          scholar,
          scholarshipId,
          scholarshipName,
          universityName,
          fees,
          applicant,
          userName,
          appliedDate,
          status,
          payment,
        } = req.body;

        // Validation
        if (
          !scholar ||
          !scholarshipId ||
          !scholarshipName ||
          !universityName ||
          !fees ||
          !applicant ||
          !userName
        ) {
          return res.status(400).send({ message: "Missing fields" });
        }

        const newApplication = {
          scholar,
          scholarshipId,
          scholarshipName,
          universityName,
          fees,
          applicant,
          userName,
          appliedDate: appliedDate || new Date(),
          status: status || "pending",
          payment: payment,
        };

        const result = await appsCollection.insertOne(newApplication);

        res.send({
          success: true,
          message: "Application submitted successfully",
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error(error);
        res
          .status(500)
          .send({ message: "Server error while saving application" });
      }
    });
    // GET: user's all applications
    app.get("/applications/user", async (req, res) => {
      try {
        const email = req.query.email;
        if (!email) {
          return res.status(400).send({ message: "Email query required" });
        }

        const result = await appsCollection
          .find({ applicant: email })
          .toArray();

        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error loading applications" });
      }
    });
    app.delete("/applications/:id", async (req, res) => {
      try {
        const id = req.params.id;

        const appDoc = await appsCollection.findOne({ _id: new ObjectId(id) });

        if (!appDoc)
          return res.status(404).send({ message: "Application not found" });

        if (appDoc.applicationStatus !== "pending") {
          return res
            .status(403)
            .send({ message: "Only pending applications can be deleted" });
        }

        const result = await appsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        res.send({ success: true, deleted: result.deletedCount });
      } catch (error) {
        res.status(500).send({ message: "Server error deleting application" });
      }
    });

    // GET: statistics
    app.get("/home/stats", async (req, res) => {
      try {
        const usersCount = await usersCollection.countDocuments();
        const appsCount = await appsCollection.countDocuments();
        const clubsCount = await clubsCollection.countDocuments();

        res.send({
          users: usersCount,
          applications: appsCount,
          clubs: clubsCount,
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({
          users: 0,
          applications: 0,
          clubs: 0,
        });
      }
    });

    // GET all applications (Moderator)
    app.get("/applications/:email", async (req, res) => {
      const { email } = req.params;
      try {
        const apps = await appsCollection
          .find({ "scholar.postedUserEmail": email })
          .toArray(); // optionally filter by moderator's assigned universities
        res.send(apps);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error fetching applications" });
      }
    });

    // UPDATE application status
    app.put("/applications/:id/status", async (req, res) => {
      try {
        const { id } = req.params;
        const { status } = req.body;
        const validStatuses = [
          "pending",
          "processing",
          "completed",
          "rejected",
        ];
        if (!validStatuses.includes(status)) {
          return res.status(400).send({ message: "Invalid status value" });
        }

        const result = await appsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Application not found" });
        }

        res.send({ success: true, message: "Status updated successfully" });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error updating status" });
      }
    });
    // UPDATE application feedback
    app.put("/applications/:id/feedback", async (req, res) => {
      try {
        const { id } = req.params;
        const { feedback } = req.body;

        const result = await appsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { feedback } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Application not found" });
        }

        res.send({ success: true, message: "Feedback saved successfully" });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error saving feedback" });
      }
    });
    // DELETE / reject application
    app.delete("/applications/delete/:id", async (req, res) => {
      try {
        const { id } = req.params;

        const result = await appsCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send({ success: true, deleted: result.deletedCount, status: 200 });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error deleting application" });
      }
    });

    // POST Reviews
    app.post("/reviews", async (req, res) => {
      try {
        const {
          scholarshipId,
          universityName,
          scholarshipName,
          userName,
          userEmail,
          postByEmail,
          userImage,
          ratingPoint,
          reviewComment,
          reviewDate,
        } = req.body;

        if (
          !scholarshipId ||
          !userName ||
          !userEmail ||
          !ratingPoint ||
          !reviewComment ||
          !postByEmail
        ) {
          return res
            .status(400)
            .send({ message: "Missing required review fields" });
        }

        const newReview = {
          scholarshipId,
          universityName,
          scholarshipName,
          userName,
          userEmail,
          postByEmail,
          userImage,
          ratingPoint: Number(ratingPoint),
          reviewComment,
          reviewDate: reviewDate || new Date(),
        };

        const result = await reviewsCollection.insertOne(newReview);

        res.send({
          success: true,
          message: "Review added successfully",
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error while saving review" });
      }
    });
    // UPDATE Review
    app.put("/reviews/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { reviewComment, ratingPoint } = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid review ID" });
        }

        const updateDoc = {
          $set: {
            reviewComment,
            ratingPoint: Number(ratingPoint),
            reviewDate: new Date(), // update timestamp
          },
        };

        const result = await reviewsCollection.updateOne(
          { _id: new ObjectId(id) },
          updateDoc
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Review not found" });
        }

        res.send({
          success: true,
          message: "Review updated successfully",
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error updating review" });
      }
    });

    // GET Single Application by ID
    app.get("/applications/details/:id", async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid application ID" });
        }

        const result = await appsCollection.findOne({ _id: new ObjectId(id) });

        if (!result) {
          return res.status(404).send({ message: "Application not found" });
        }

        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error loading application" });
      }
    });
    // UPDATE Application (Full Update)
    app.put("/applications/:id", async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid application ID" });
        }

        const updateData = req.body;

        const result = await appsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Application not found" });
        }

        res.send({
          success: true,
          message: "Application updated successfully",
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error updating application" });
      }
    });

    // GET dashboard stats
    app.get("/analytics/stats", async (req, res) => {
      try {
        const usersCount = await usersCollection.countDocuments();
        const clubsCount = await clubsCollection.countDocuments();
        const paymentsData = await paymentsCollection.find().toArray();
        const totalFees = paymentsData.reduce((sum, p) => sum + p.amount, 0);

        // Count applications per university
        const apps = await appsCollection.find().toArray();
        const appCountPerUniversity = apps.reduce((acc, curr) => {
          acc[curr.universityName] = (acc[curr.universityName] || 0) + 1;
          return acc;
        }, {});

        res.send({
          usersCount,
          clubsCount,
          totalFees,
          appCountPerUniversity,
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({
          usersCount: 0,
          clubsCount: 0,
          totalFees: 0,
          appCountPerUniversity: {},
        });
      }
    });
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Welcome to server");
});

app.listen(port, () => {
  console.log(`Server is running on ${port}`);
});
