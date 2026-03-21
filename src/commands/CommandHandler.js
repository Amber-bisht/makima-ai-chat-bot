import * as adminCommands from './admin/index.js';
import * as ownerCommands from './owner/index.js';
import * as publicCommands from './public/index.js';

export class CommandHandler {
  constructor(bot, services, config) {
    this.bot = bot;
    this.services = { ...services, config };
    this.config = config;

    this.publicMap = new Map();
    this.publicMap.set('/start', publicCommands.startCommand);
    this.publicMap.set('/help', publicCommands.helpCommand);
  }

  async handlePublic(command, msg) {
    const handler = this.publicMap.get(command);
    if (handler) {
      await handler(this.bot, msg, this.services);
      return true;
    }
    return false;
  }

  async handleOwner(command, msg, text, args) {
    switch (command) {
      case '/stats': await ownerCommands.statsCommand(this.bot, msg, this.services); return true;
      case '/memory': await ownerCommands.memoryCommand(this.bot, msg, args, this.services); return true;
      case '/feed': await ownerCommands.feedCommand(this.bot, msg, text, this.services); return true;
      case '/text': await ownerCommands.textCommand(this.bot, msg, text, this.services); return true;
      case '/data': await ownerCommands.dataCommand(this.bot, msg, text, this.services); return true;
      case '/ignore': await ownerCommands.ignoreCommand(this.bot, msg, args, this.services); return true;
      case '/clear_user': await ownerCommands.clearUserCommand(this.bot, msg, args, this.services); return true;
      case '/reply': await ownerCommands.replyCommand(this.bot, msg, args, text); return true;
    }
    if (this.publicMap.has(command)) {
       await this.handlePublic(command, msg);
       return true;
    }
    return false;
  }

  async handleAdmin(command, msg, text, args) {
    switch(command) {
      case '/ban': await adminCommands.banCommand(this.bot, msg, args, this.services); return true;
      case '/dban': await adminCommands.dbanCommand(this.bot, msg, args, this.services); return true;
      case '/kick': await adminCommands.kickCommand(this.bot, msg, args, this.services); return true;
      case '/fban': await adminCommands.fbanCommand(this.bot, msg, args, this.services); return true;
      case '/unban': await adminCommands.unbanCommand(this.bot, msg, args, this.services); return true;
      case '/funban': await adminCommands.funbanCommand(this.bot, msg, args, this.services); return true;
      case '/mute': await adminCommands.muteCommand(this.bot, msg, args, this.services); return true;
      case '/unmute': await adminCommands.unmuteCommand(this.bot, msg, args, this.services); return true;
      case '/warn': await adminCommands.warnCommand(this.bot, msg, args, this.services); return true;
      case '/unwarn': await adminCommands.unwarnCommand(this.bot, msg, args, this.services); return true;
      case '/purge': await adminCommands.purgeCommand(this.bot, msg); return true;
      case '/rules': await adminCommands.rulesCommand(this.bot, msg, text, this.services); return true;
      case '/check_bot': await adminCommands.checkBotCommand(this.bot, msg, this.services); return true;
      case '/id': await adminCommands.idCommand(this.bot, msg); return true;
    }
    return false;
  }
}
