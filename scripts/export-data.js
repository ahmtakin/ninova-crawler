/**
 * Export crawled data from MongoDB to data/storage/p.data (JSON format).
 *
 * Usage: node scripts/export-data.js
 * Requires: MongoDB running with crawled data
 */

const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/ninova';
const OUTPUT_DIR = path.join(__dirname, '..', 'data', 'storage');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'p.data');

async function exportData() {
  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    const db = client.db();

    console.log('Connected to MongoDB. Exporting crawled data...');

    // Export pages collection (the raw crawled page data)
    const pages = await db.collection('pages').find({}, {
      projection: {
        url: 1,
        crawlJobId: 1,
        origin: 1,
        depth: 1,
        title: 1,
        statusCode: 1,
        contentType: 1,
        textContent: 1,
        links: 1,
        wordCount: 1,
        fetchedAt: 1,
        indexedAt: 1
      }
    }).toArray();

    // Export crawl jobs for context
    const jobs = await db.collection('crawl_jobs').find({}).toArray();

    const exportPayload = {
      exportedAt: new Date().toISOString(),
      stats: {
        totalPages: pages.length,
        totalJobs: jobs.length
      },
      crawlJobs: jobs,
      pages: pages
    };

    // Ensure output directory exists
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    // Write JSON
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(exportPayload, null, 2), 'utf-8');

    console.log(`Exported ${pages.length} pages and ${jobs.length} jobs to ${OUTPUT_FILE}`);
    console.log(`File size: ${(fs.statSync(OUTPUT_FILE).size / 1024 / 1024).toFixed(2)} MB`);

  } finally {
    await client.close();
  }
}

exportData().catch(err => {
  console.error('Export failed:', err.message);
  process.exit(1);
});
