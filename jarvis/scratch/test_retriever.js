// Set up environment variables
require('dotenv').config({ path: '.env.local' });
const { retrieveRelevantMemories } = require('../src/lib/memory/retriever');

async function test() {
  try {
    console.log("Starting retrieveRelevantMemories test...");
    const start = Date.now();
    const result = await retrieveRelevantMemories("hello");
    console.log("Success! Time taken:", Date.now() - start, "ms");
    console.log("Result:", JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("Error occurred:", err);
  }
}

test();
