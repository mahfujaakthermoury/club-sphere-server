require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express');
const cors = require('cors');
const port = 3000;

const app = express();
app.use(cors());
app.use(express.json())

app.get('/', (req, res) => {
  res.send('Hello, Developer')
})

app.listen(port, () => {
  console.log(`Server is running on ${port}`);

})
