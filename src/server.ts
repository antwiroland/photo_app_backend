import express from "express";
import multer from "multer";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { Pool } from "pg";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const upload = multer(); // parse multipart/form-data

// Postgres connection pool
const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// S3 client
const s3 = new S3Client({ region: process.env.AWS_REGION });
const bucketName = process.env.S3_BUCKET || "";

// Upload endpoint
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    const description = req.body.description;

    if (!file) return res.status(400).send("No file uploaded");

    const key = `uploads/${Date.now()}-${file.originalname}`;

    // Upload to S3
    await s3.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      })
    );

    // Generate presigned URL (2 days)
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: bucketName, Key: key }),
      { expiresIn: 60 * 60 * 24 * 2 }
    );

    // Save metadata in RDS
    await pool.query(
      "INSERT INTO photos (s3_key, description, presigned_url) VALUES ($1, $2, $3)",
      [key, description, url]
    );

    res.json({ message: "Upload successful", url });
  } catch (err) {
    console.error("Upload failed:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});

// Gallery endpoint
app.get("/gallery", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT description, presigned_url, created_at FROM photos ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch gallery failed:", err);
    res.status(500).json({ error: "Failed to fetch gallery" });
  }
});

app.listen(8080, () => console.log("Server running on port 8080"));
