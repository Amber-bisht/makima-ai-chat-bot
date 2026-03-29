import { extractJsonObjects } from "../src/ai/GroqService.js";

const sampleReply = `
Here are 3 AWS MCQs for you:
{
  "type": "poll",
  "question": "Q1?",
  "options": ["A", "B"],
  "correct_option_index": 0
}
And another:
{
  "type": "poll",
  "question": "Q2?",
  "options": ["C", "D"],
  "correct_option_index": 1
}
Good luck!
`;

const jsonObjects = extractJsonObjects(sampleReply);
console.log("Extracted JSON Objects count:", jsonObjects.length);

let textToReply = sampleReply;
const polls = jsonObjects.filter(obj => obj.type === "poll");

for (const obj of jsonObjects) {
    try {
        const jsonStr = JSON.stringify(obj);
        // Note: replace might not work perfectly if formatting is different, 
        // but our events.js also uses a regex fallback.
        textToReply = textToReply.replace(jsonStr, "").trim();
    } catch (e) {}
}
textToReply = textToReply.replace(/\{[\s\S]*?\}/g, "").trim();

console.log("Remaining Text:", textToReply);
console.log("Polls found:", polls.length);

if (polls.length === 2 && textToReply.includes("Here are 3 AWS MCQs for you:") && textToReply.includes("Good luck!")) {
    console.log("✅ Verification Successful: Multiple polls and text correctly handled.");
} else {
    console.error("❌ Verification Failed.");
    process.exit(1);
}
