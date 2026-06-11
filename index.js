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
      "https://lustrous-sherbet-1d11fb.netlify.app",
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
    const eventsCollection = database.collection("events");
    const appsCollection = database.collection("applications");
    const regisCollection = database.collection("registrations");
    const paymentsCollection = database.collection("payments");

    // jwt
    // CREATE JWT
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

    // Admin or Manager middleware
    const verifyAdmin = async (req, res, next) => {
      try {
        const email = req.decoded?.email;
        if (!email) {
          return res.status(401).send({ message: "Unauthorized" });
        }

        const user = await usersCollection.findOne({ email });
        if (!user || user.role !== "Admin") {
          return res.status(403).send({ message: "Forbidden: Admin Only" });
        }

        next();
      } catch (error) {
        res.status(500).send({ message: "Server Error" });
      }
    };

    const verifyManager = async (req, res, next) => {
      try {
        const email = req.decoded?.email;
        if (!email) {
          return res.status(401).send({ message: "Unauthorized" });
        }

        const user = await usersCollection.findOne({ email });
        if (!user || (user.role !== "Manager" && user.role !== "Admin")) {
          return res.status(403).send({ message: "Forbidden: Manager only" });
        }

        next();
      } catch (error) {
        res.status(500).send({ message: "Server error" });
      }
    };

    // payment
    app.post("/create-payment-intent", async (req, res) => {
      const { amount, clubId, eventId } = req.body;

      const paymentIntent = await stripe.paymentIntents.create({
        amount: parseInt(amount * 100), // convert to cents
        currency: "usd",
        metadata: {
          clubId: clubId || "",
          eventId: eventId || "",
        },
      });

      res.send({ clientSecret: paymentIntent.client_secret });
    });

    // Save Payment Info
    app.post("/payments", async (req, res) => {
      try {
        const {
          clubId,
          clubName,
          eventId,
          eventName,
          amount,
          transactionId,
          email,
        } = req.body;

        if ((!clubId && !eventId) || amount == null || !transactionId || !email) {
          return res.status(400).send({ message: "Missing payment fields" });
        }

        const paymentData = {
          clubId: clubId || null,
          clubName: clubName || null,

          eventId: eventId || null,
          eventName: eventName || null,

          amount,
          transactionId,
          email,

          type: clubId ? "Club" : "Event",

          paidAt: new Date(),
          status: "completed",
        };

        const result = await paymentsCollection.insertOne(paymentData);

        res.send({
          success: true,
          message: "Payment saved successfully",
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error while saving payment" });
      }
    });

    //get all payments transection 
    app.get("/payments", async (req, res) => {
      const result = await paymentsCollection.find().toArray();
      console.log("Payments:", result.length);
      res.send(result);
    });


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
        const validRoles = ["Member", "Manager"];
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
    // Assign manager
    app.put("/users/assign/:email", async (req, res) => {
      try {
        const { email } = req.params;
        const { managerFor } = req.body;

        const result = await usersCollection.updateOne(
          { email },
          { $set: { managerFor } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "User not found" });
        }

        res.send({ success: true, message: "Manager assigned successfully" });
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
            { clubName: { $regex: search, $options: "i" } },
            { category: { $regex: search, $options: "i" } },
            { location: { $regex: search, $options: "i" } },
          ];
        }

        if (category) {
          query.category = { $regex: category, $options: "i" };
        }

        if (sortBy) {
          const sortOrder = order === "asc" ? 1 : -1;

          if (sortBy === "membershipFee") {
            sortOption.membershipFee = sortOrder;
          }

          if (sortBy === "createdAt") {
            sortOption.createdAt = sortOrder;
          }
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

    // GET all events (search + filter + sort + pagination)
    app.get("/events", async (req, res) => {
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
            { eventName: { $regex: search, $options: "i" } },
            { category: { $regex: search, $options: "i" } },
            { location: { $regex: search, $options: "i" } },
          ];
        }

        if (category) {
          query.eventCategory = category;
        }

        if (sortBy) {
          const sortOrder = order === "asc" ? 1 : -1;
          if (sortBy === "fees") sortOption.eventFee = sortOrder;
          if (sortBy === "date") sortOption.postedDate = sortOrder;
        }

        const skip = (Number(page) - 1) * Number(limit);

        const total = await eventsCollection.countDocuments(query);

        const events = await eventsCollection
          .find(query)
          .sort(sortOption)
          .skip(skip)
          .limit(Number(limit))
          .toArray();

        res.send({
          data: events,
          total,
          page: Number(page),
          totalPages: Math.ceil(total / limit),
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // CREATE Registrations
    app.post("/registrations", async (req, res) => {
      try {
        const {
          eventId,
          userEmail,
          clubId,
          eventName,
          managerEmail,
          location,
          eventFee,
          registeredAt,
          status,
          payment,
        } = req.body;

        console.log(req.body);
        // Validation
        if (
          !eventId ||
          !eventName ||
          !userEmail
        ) {
          return res.status(400).send({ message: "Missing fields" });
        }

        const newRegistrations = {
          eventId,
          userEmail,
          clubId,
          eventName,
          managerEmail,
          location,
          eventFee,
          registeredAt: registeredAt || new Date(),
          status: status || "pending",
          payment: payment,
        };

        const result = await regisCollection.insertOne(newRegistrations);

        res.send({
          success: true,
          message: "Registration successfully",
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error(error);
        res
          .status(500)
          .send({ message: "Server error while registration" });
      }
    });


    // GET: user's all registrations
    app.get("/registrations/user", async (req, res) => {
      try {
        const email = req.query.email;

        console.log("Email:", email);

        const result = await regisCollection
          .find({ applicant: email })
          .toArray();

        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error loading registred events" });
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
      const result = await clubsCollection.find({}).limit(8).toArray();
      res.send(result);
    });
    // GET manager clubs
    app.get("/clubs/:manager", async (req, res) => {
      const managerEmail = req.params.manager;

      const result = await clubsCollection
        .find({ postedUserEmail: managerEmail })
        .toArray();
      res.send(result);
    });

    app.get("/applications", async (req, res) => {
      const result = await appsCollection.find().toArray();
      res.send(result);
    });

    // GET: user's all applications
    app.get("/applications/user", async (req, res) => {
      try {
        const email = req.query.email;

        console.log("Email:", email);

        const result = await appsCollection
          .find({ applicant: email })
          .toArray();

        console.log("Result:", result);

        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error loading applications" });
      }
    });

    // GET: manager's all applications
    app.get("/applications/:email", async (req, res) => {
      try {
        const email = req.params.email;
        if (!email) {
          return res.status(400).send({ message: "Email query required" });
        }

        const result = await appsCollection
          .find({ managerEmail: email })
          .toArray();

        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error loading clubs" });
      }
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

        // Optional: verify that the user deleting this club is the manager
        const club = await clubsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!club)
          return res.status(404).send({ message: "club not found" });

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

    // GET manager club data
    app.get("/club/data/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const result = await clubsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!result) {
          return res.status(404).send({ message: "No club found" });
        }

        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server error" });
      }
    });
    // UPDATE manager club data
    app.put("/club/update/:id", async (req, res) => {
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

    // Update clubs status 
    app.patch("/clubs/status/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { status } = req.body;

        const result = await clubsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              status,
            },
          }
        );

        res.send({
          success: true,
          modifiedCount: result.modifiedCount,
        });
      } catch (error) {
        res.status(500).send({
          success: false,
          message: "Failed to update status",
        });
      }
    });

    // POST events
    app.post("/events", async (req, res) => {
      const data = req.body;
      const result = await eventsCollection.insertOne(data);
      res.send(result);
    });

    // GET manager events
    app.get("/events/manager/:email", async (req, res) => {
      const email = req.params.email;

      console.log("Route Email:", email);

      const result = await eventsCollection
        .find({ managerEmail: email })
        .toArray();

      console.log("Found Events:", result);

      res.send(result);
    });

    // UPDATE manager event data
    app.put("/event/update/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const data = req.body;

        const result = await eventsCollection.updateOne(
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

    app.get("/events", async (req, res) => {
      const result = await eventsCollection.find({}).toArray();
      res.send(result);
    });

    app.get("/events/data/:id", async (req, res) => {
      try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid event ID" });
        }

        const result = await eventsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!result) {
          return res.status(404).send({ message: "Event not found" });
        }

        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error" });
      }
    });


    // GET registrations filtered by clubId
    app.get("/registrations", async (req, res) => {
      try {
        const clubId = req.query.clubId;
        const email = req.query.email;
        const modMail = req.query.modMail;

        let query = {};

        if (clubId) {
          query.clubId = clubId;
        }

        if (email) {
          query.userEmail = email;
        }

        if (modMail) {
          query.postByEmail = modMail;
        }

        const result = await regisCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // CREATE Application
    app.post("/applications", async (req, res) => {
      try {
        const {
          clubId,
          clubImage,
          category,
          clubName,
          managerEmail,
          location,
          membershipFee,
          applicant,
          userName,
          appliedDate,
          status,
          payment,
        } = req.body;

        console.log("APPLICATION BODY:", req.body);
        // Validation
        if (
          !clubId ||
          !clubName ||
          !applicant ||
          !userName
        ) {
          return res.status(400).send({ message: "Missing fields" });
        }

        const newApplication = {
          clubId,
          clubImage,
          category,
          clubName,
          managerEmail,
          location,
          membershipFee,
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

    // app.delete("/applications/:id", async (req, res) => {
    //   try {
    //     const id = req.params.id;

    //     const appDoc = await appsCollection.findOne({ _id: new ObjectId(id) });

    //     if (!appDoc)
    //       return res.status(404).send({ message: "Application not found" });

    //     if (appDoc.applicationStatus !== "pending") {
    //       return res
    //         .status(403)
    //         .send({ message: "Only pending applications can be deleted" });
    //     }

    //     const result = await appsCollection.deleteOne({
    //       _id: new ObjectId(id),
    //     });

    //     res.send({ success: true, deleted: result.deletedCount });
    //   } catch (error) {
    //     res.status(500).send({ message: "Server error deleting application" });
    //   }
    // });

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

    // // GET all applications (Manager)
    // app.get("/applications/:email", async (req, res) => {
    //   const { email } = req.params;

    //   try {
    //     const applications = await appsCollection
    //       .find({
    //         managerEmail: email,
    //       })
    //       .toArray();

    //     res.send(applications);
    //   } catch (err) {
    //     res.status(500).send({
    //       message: "Server error",
    //     });
    //   }
    // });

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

    //......

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

    // GET dashboard stats
    app.get("/analytics/stats", async (req, res) => {
      try {
        const eventsCount = await eventsCollection.countDocuments();
        const clubsCount = await clubsCollection.countDocuments();
        const paymentsData = await paymentsCollection.find().toArray();
        const totalFees = paymentsData.reduce((sum, p) => sum + p.amount, 0);

        // Count applications per club
        const apps = await appsCollection.find().toArray();
        const appCountPerClub = apps.reduce((acc, curr) => {
          acc[curr.clubName] = (acc[curr.clubName] || 0) + 1;
          return acc;
        }, {});

        res.send({
          eventsCount,
          clubsCount,
          totalFees,
          appCountPerClub,
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({
          eventsCount: 0,
          clubsCount: 0,
          totalFees: 0,
          appCountPerClub: {},
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
