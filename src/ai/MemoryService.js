import ContactRequest from "../models/ContactRequest.js";
import OwnerFeed from "../models/OwnerFeed.js";
import UserMemory from "../models/UserMemory.js";
import GroupMemory from "../models/GroupMemory.js";
import GroupConfig from "../models/GroupConfig.js";

function compactText(value, maxLen = 220) {
  if (!value) return null;
  const cleaned = String(value).trim().replace(/\s+/g, " ");
  if (!cleaned) return null;
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 3)}...` : cleaned;
}

function dedupeStrings(values, maxItems = 30) {
  const seen = new Set();
  const result = [];

  for (const raw of values) {
    const text = compactText(raw);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= maxItems) break;
  }

  return result;
}

function toGroupInfo(chat) {
  if (!chat) return null;
  return {
    id: chat.id,
    title: chat.title || null,
    username: chat.username || null
  };
}

export class MemoryService {
  constructor({ cache }) {
    this.cache = cache;
    this.ownerFeedCache = new Map();
  }

  normalizeOwnerState(doc) {
    const notes = (doc?.notes || [])
      .map((note) => compactText(note.text, 800))
      .filter(Boolean);
    const knowledgeNotes = (doc?.knowledgeNotes || [])
      .map((note) => compactText(note.text, 800))
      .filter(Boolean);

    const ignoredUserIds = Array.from(
      new Set(
        (doc?.ignoredUserIds || [])
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id))
      )
    );

    return { notes, knowledgeNotes, ignoredUserIds };
  }

  async getOwnerState(ownerUserId) {
    const key = String(ownerUserId);
    const cached = this.ownerFeedCache.get(key);
    if (cached) {
      return {
        notes: [...cached.notes],
        knowledgeNotes: [...cached.knowledgeNotes],
        ignoredUserIds: [...cached.ignoredUserIds]
      };
    }

    const doc = await OwnerFeed.findOne({ ownerUserId }).lean();
    const normalized = this.normalizeOwnerState(doc);
    this.ownerFeedCache.set(key, normalized);
    return {
      notes: [...normalized.notes],
      knowledgeNotes: [...normalized.knowledgeNotes],
      ignoredUserIds: [...normalized.ignoredUserIds]
    };
  }

  async touchUser(user, chat) {
    const now = new Date();
    const doc = await UserMemory.findOneAndUpdate(
      { userId: user.id },
      {
        $setOnInsert: {
          userId: user.id,
          name: user.first_name || null,
          about: [],
          facts: [],
          conversationSummaries: [],
          pastQuestions: []
        },
        $set: {
          username: user.username || null,
          lastSeenGroup: toGroupInfo(chat),
          lastInteractionAt: now
        },
        $inc: {
          messageCount: 1
        }
      },
      { upsert: true, new: true, lean: true }
    );

    this.cache.set(user.id, doc);
    return doc;
  }

  async logGroupMessage(chat, user, text) {
    if (!chat || !user || !text) return;
    const msgData = {
      userId: user.id,
      name: user.first_name || user.username || "Unknown",
      text: compactText(text, 500)
    };

    try {
      await GroupMemory.findOneAndUpdate(
        { chatId: chat.id },
        {
          $setOnInsert: { chatId: chat.id, chatTitle: chat.title || null },
          $push: {
            messages: {
              $each: [msgData],
              $slice: -20 // keep last 20 messages
            }
          }
        },
        { upsert: true }
      );
    } catch (err) {
      console.error("Failed to log group message context:", err.message);
    }
  }

  async getGroupContext(chatId) {
    if (!chatId) return [];
    try {
      const doc = await GroupMemory.findOne({ chatId }).lean();
      return doc?.messages || [];
    } catch {
      return [];
    }
  }

  async getGroupRules(chatId) {
    if (!chatId) return null;
    try {
      const doc = await GroupConfig.findOne({ chatId }).lean();
      return doc || null;
    } catch {
      return null;
    }
  }

  async setGroupRules(chatId, rulesText, rulesButtons = []) {
    if (!chatId) return null;
    try {
      const updated = await GroupConfig.findOneAndUpdate(
        { chatId },
        { 
          $set: { rulesText, rulesButtons } 
        },
        { upsert: true, new: true, lean: true }
      );
      return updated;
    } catch (err) {
      console.error("Failed to set group rules:", err.message);
      return null;
    }
  }

  async setLastWelcomeId(chatId, lastWelcomeId) {
    if (!chatId) return null;
    try {
      return await GroupConfig.findOneAndUpdate(
        { chatId },
        { $set: { lastWelcomeId } },
        { upsert: true, new: true, lean: true }
      );
    } catch (err) {
      console.error("Failed to set last welcome ID:", err.message);
      return null;
    }
  }

  async getUserMemory(userId) {
    const cached = this.cache.get(userId);
    if (cached) return cached;

    const doc = await UserMemory.findOne({ userId }).lean();
    if (!doc) return null;

    this.cache.set(userId, doc);
    return doc;
  }

  async getUserMemoryByLookup(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;

    if (/^-?\d+$/.test(raw)) {
      return this.getUserMemory(Number(raw));
    }

    if (/^[a-fA-F0-9]{24}$/.test(raw)) {
      const doc = await UserMemory.findById(raw).lean();
      if (!doc) return null;
      this.cache.set(doc.userId, doc);
      return doc;
    }

    return null;
  }

  async mergeExtractedMemory(userId, extracted) {
    if (!extracted || !extracted.shouldStore) return this.getUserMemory(userId);

    const current = (await this.getUserMemory(userId)) || {};
    const patch = {};

    if (extracted.name && (!current.name || current.name.toLowerCase() === "unknown")) {
      patch.name = compactText(extracted.name, 80);
    }

    const nextFacts = dedupeStrings([...(current.facts || []), ...(extracted.facts || [])], 40);
    if (JSON.stringify(nextFacts) !== JSON.stringify(current.facts || [])) {
      patch.facts = nextFacts;
    }

    const extractedQuestions = [
      ...(extracted.pastQuestions || []),
      ...(extracted.pastQuestion ? [extracted.pastQuestion] : [])
    ];
    const nextQuestions = dedupeStrings([...(current.pastQuestions || []), ...extractedQuestions], 40);
    if (JSON.stringify(nextQuestions) !== JSON.stringify(current.pastQuestions || [])) {
      patch.pastQuestions = nextQuestions;
    }

    const nextSummaries = dedupeStrings(
      [
        ...(current.conversationSummaries || []),
        ...(extracted.summary ? [extracted.summary] : []),
        ...(extracted.conversationSummaries || [])
      ],
      20
    );
    if (JSON.stringify(nextSummaries) !== JSON.stringify(current.conversationSummaries || [])) {
      patch.conversationSummaries = nextSummaries;
    }

    if (!Object.keys(patch).length) return current;

    const updated = await UserMemory.findOneAndUpdate({ userId }, { $set: patch }, { new: true, lean: true });
    if (updated) this.cache.set(userId, updated);
    return updated;
  }

  async logContactRequest({ message, user, chat }) {
    await ContactRequest.create({
      requesterUserId: user.id,
      requesterName: user.first_name || null,
      requesterUsername: user.username || null,
      groupId: chat.id,
      groupTitle: chat.title || null,
      groupUsername: chat.username || null,
      message: compactText(message, 800) || ""
    });

    const updated = await UserMemory.findOneAndUpdate(
      { userId: user.id },
      {
        $setOnInsert: {
          userId: user.id,
          name: user.first_name || null,
          about: [],
          facts: [],
          conversationSummaries: [],
          pastQuestions: []
        },
        $set: {
          username: user.username || null,
          lastSeenGroup: toGroupInfo(chat),
          lastInteractionAt: new Date()
        },
        $inc: {
          contactRequestCount: 1
        }
      },
      { upsert: true, new: true, lean: true }
    );

    this.cache.set(user.id, updated);
  }

  async getStats() {
    const [totalUsers, totalContactRequests] = await Promise.all([
      UserMemory.countDocuments(),
      ContactRequest.countDocuments()
    ]);

    return {
      totalUsers,
      totalContactRequests,
      cache: this.cache.stats()
    };
  }

  async listRecentMemories(limit = 10) {
    return UserMemory.find({})
      .sort({ lastInteractionAt: -1, updatedAt: -1 })
      .limit(limit)
      .lean();
  }

  async clearUser(userId) {
    await UserMemory.deleteOne({ userId });
    this.cache.delete(userId);
  }

  async getOwnerFeed(ownerUserId) {
    const state = await this.getOwnerState(ownerUserId);
    return state.notes;
  }

  async getOwnerKnowledge(ownerUserId) {
    const state = await this.getOwnerState(ownerUserId);
    return state.knowledgeNotes;
  }

  async getIgnoredUserIds(ownerUserId) {
    const state = await this.getOwnerState(ownerUserId);
    return state.ignoredUserIds;
  }

  async addIgnoredUser(ownerUserId, targetUserId) {
    const userId = Number(targetUserId);
    if (!Number.isFinite(userId)) {
      throw new Error("Invalid user ID for ignore.");
    }

    const updated = await OwnerFeed.findOneAndUpdate(
      { ownerUserId },
      {
        $setOnInsert: {
          ownerUserId,
          notes: [],
          knowledgeNotes: []
        },
        $addToSet: {
          ignoredUserIds: userId
        }
      },
      { upsert: true, new: true, lean: true }
    );

    const normalized = this.normalizeOwnerState(updated);
    this.ownerFeedCache.set(String(ownerUserId), normalized);
    return normalized.ignoredUserIds;
  }

  async addOwnerFeed(ownerUserId, rawText) {
    const text = compactText(rawText, 800);
    if (!text) {
      throw new Error("Feed text is empty.");
    }

    const updated = await OwnerFeed.findOneAndUpdate(
      { ownerUserId },
      {
        $setOnInsert: { ownerUserId, ignoredUserIds: [], knowledgeNotes: [] },
        $push: {
          notes: {
            $each: [{ text, createdAt: new Date() }],
            $slice: -120
          }
        }
      },
      { upsert: true, new: true, lean: true }
    );

    const normalized = this.normalizeOwnerState(updated);
    this.ownerFeedCache.set(String(ownerUserId), normalized);
    return {
      added: text,
      notes: normalized.notes
    };
  }

  async addOwnerKnowledge(ownerUserId, rawText) {
    const text = compactText(rawText, 800);
    if (!text) {
      throw new Error("Text knowledge is empty.");
    }

    const updated = await OwnerFeed.findOneAndUpdate(
      { ownerUserId },
      {
        $setOnInsert: { ownerUserId, ignoredUserIds: [], notes: [] },
        $push: {
          knowledgeNotes: {
            $each: [{ text, createdAt: new Date() }],
            $slice: -220
          }
        }
      },
      { upsert: true, new: true, lean: true }
    );

    const normalized = this.normalizeOwnerState(updated);
    this.ownerFeedCache.set(String(ownerUserId), normalized);
    return {
      added: text,
      knowledgeNotes: normalized.knowledgeNotes
    };
  }

  async getUserIdByUsername(username) {
    if (!username) return null;
    const clean = String(username).replace(/^@/, '');
    const doc = await UserMemory.findOne({ username: { $regex: new RegExp(`^${clean}$`, 'i') } }).lean();
    return doc?.userId || null;
  }

  async addWarning(userId) {
    const targetUserId = Number(userId);
    if (!Number.isFinite(targetUserId)) return 0;
    
    const updated = await UserMemory.findOneAndUpdate(
      { userId: targetUserId },
      {
        $setOnInsert: {
          userId: targetUserId,
          messageCount: 0,
          contactRequestCount: 0
        },
        $inc: { warnings: 1 }
      },
      { upsert: true, new: true, lean: true }
    );
    this.cache.set(targetUserId, updated);
    return updated.warnings;
  }

  async removeWarning(userId) {
    const targetUserId = Number(userId);
    if (!Number.isFinite(targetUserId)) return 0;
    
    const doc = await UserMemory.findOne({ userId: targetUserId }).lean();
    if (!doc || !doc.warnings) return 0;

    const updated = await UserMemory.findOneAndUpdate(
      { userId: targetUserId },
      { $inc: { warnings: -1 } },
      { new: true, lean: true }
    );
    this.cache.set(targetUserId, updated);
    return updated.warnings;
  }

  async addUserManualData(userId, rawText) {
    const targetUserId = Number(userId);
    if (!Number.isFinite(targetUserId)) {
      throw new Error("Invalid user ID for /data.");
    }

    const text = compactText(rawText, 800);
    if (!text) {
      throw new Error("Data text is empty.");
    }

    const current = (await this.getUserMemory(targetUserId)) || {};
    const nextAbout = dedupeStrings([...(current.about || []), text], 80);

    const updated = await UserMemory.findOneAndUpdate(
      { userId: targetUserId },
      {
        $setOnInsert: {
          userId: targetUserId,
          name: current.name || null,
          facts: [],
          conversationSummaries: [],
          pastQuestions: []
        },
        $set: {
          about: nextAbout,
          lastInteractionAt: new Date()
        }
      },
      { upsert: true, new: true, lean: true }
    );

    this.cache.set(targetUserId, updated);
    return updated;
  }
}
