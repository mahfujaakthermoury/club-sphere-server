require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express');
const cors = require('cors');
const port = process.env.PORT  || 3000;

const app = express();
app.use(cors());
app.use(express.json())

const uri = "mongodb+srv://club-sphere:i8NZUzzjAj8DY4mz@clusterhub.3pf2lfb.mongodb.net/?appName=ClusterHub";

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    await client.connect();

    //create database and collection 
    const database = client.db('clubSphere')
    const userCollection = database.collection('user')

    // Users data post and get
    app.post('/users', async(req, res)=>{
      const userInfo = req.body
      userInfo.createdAt =  new Date();
        
      const result = await userCollection.insertOne(userInfo)
      res.send(result)
    })

    app.get('/users/role/:email', async(req, res)=>{
      const {email} = req.params
      const query = {email:email}

      const result = await userCollection.findOne(query)
      res.send(result)
    })
    
    await client.db("admin").command({ ping: 1 });
    console.log("Successfully connected to MongoDB!");
  } finally {

  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('Hello, Developer')
})

app.listen(port, () => {
  console.log(`Server is running on ${port}`);
})
