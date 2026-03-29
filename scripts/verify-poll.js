import { extractJsonObjects } from "../src/ai/GroqService.js";

const sampleReply = `
Here are 2 AWS MCQs for you:
{
  "type": "poll",
  "question": "Q1?",
  "options": ["A", "B"],
  "correct_option_id": 1
}
{
  "type": "poll",
  "question": "Q2?",
  "options": ["C", "D"],
  "correct_option_index": 5
}
`;

const jsonObjects = extractJsonObjects(sampleReply);
const polls = jsonObjects.filter(obj => obj.type === "poll");

for (let i = 0; i < polls.length; i++) {
    const pollData = polls[i];
    let correctIndex = parseInt(pollData.correct_option_id ?? pollData.correct_option_index);
    if (isNaN(correctIndex) || correctIndex < 0 || correctIndex >= pollData.options.length) {
        correctIndex = 0;
    }
    console.log(`Poll ${i+1} Correct Index:`, correctIndex);
    
    if (i === 0 && correctIndex !== 1) throw new Error("Poll 1 failed");
    if (i === 1 && correctIndex !== 0) throw new Error("Poll 2 fallback failed");
}

console.log("✅ Verification Successful: Both keys and fallback handled correctly.");
