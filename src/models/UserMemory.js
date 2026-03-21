import mongoose from "mongoose";

const GroupInfoSchema = new mongoose.Schema(
  {
    id: { type: Number },
    title: { type: String },
    username: { type: String }
  },
  { _id: false }
);

const UserMemorySchema = new mongoose.Schema(
  {
    userId: { type: Number, required: true, unique: true, index: true },
    username: { type: String, default: null },
    name: { type: String, default: null },
    about: { type: [String], default: [] },
    facts: { type: [String], default: [] },
    conversationSummaries: { type: [String], default: [] },
    pastQuestions: { type: [String], default: [] },
    lastSeenGroup: { type: GroupInfoSchema, default: null },
    messageCount: { type: Number, default: 0 },
    contactRequestCount: { type: Number, default: 0 },
    warnings: { type: Number, default: 0 },
    lastInteractionAt: { type: Date, default: null }
  },
  { timestamps: true }
);

export default mongoose.model("UserMemory", UserMemorySchema);
