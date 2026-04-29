const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const axios = require("axios");
const { MercadoPagoConfig, Payment, Preference } = require("mercadopago");

// Configurações
const BOT_TOKEN = "desgraçado do token do seu bot aki fdp";
const ADMIN_ID = 7132354672;
const MP_ACCESS_TOKEN = "SUA_ACCESS_TOKEN_DO_MERCADO_PAGO"; // CONFIGURE AQUI

// Inicializar bot com webhook ao invés de polling
const bot = new TelegramBot(BOT_TOKEN);

// Inicializar Mercado Pago
const client = new MercadoPagoConfig({
  accessToken: MP_ACCESS_TOKEN,
});
const payment = new Payment(client);
const preference = new Preference(client);

// Express para webhook do Mercado Pago e interface web
const app = express();
app.use(express.json());
app.use(express.static("public"));

// Banco de dados em memória (simples)
const db = {
  users: {}, // userId: { name, balance, id, banned, blocked }
  startMedia: null, // { type: 'photo' | 'video', fileId }
  maintenance: false,
  doubleBalance: false,
  payments: {}, // paymentId: userId
  gifts: {}, // giftCode: amount
  tempBroadcast: null,
  awaitingMessage: {}, // userId: { type, callback }
  minesGames: {}, // userId: { board, revealed, bombs, bet, multiplier }
};

// Lista de jogos do casino
const games = [
  { name: "🎰 Fortune Tiger", icon: "🐯", bet: 5 },
  { name: "🐉 Fortune Dragon", icon: "🐉", bet: 5 },
  { name: "🐂 Fortune Ox", icon: "🐂", bet: 5 },
  { name: "🐭 Fortune Mouse", icon: "🐭", bet: 5 },
  { name: "💎 Gates of Olympus", icon: "⚡", bet: 10 },
  { name: "🍬 Sugar Rush", icon: "🍭", bet: 5 },
  { name: "⭐ Starlight Princess", icon: "👸", bet: 10 },
  { name: "🎪 Circus Launch", icon: "🎪", bet: 5 },
  { name: "🔥 Wild Coaster", icon: "🎢", bet: 5 },
  { name: "💰 Crazy Time", icon: "🎡", bet: 15 },
  { name: "🎲 Aviator", icon: "✈️", bet: 5 },
  { name: "🃏 Blackjack", icon: "🃏", bet: 10 },
  { name: "🎯 Mines", icon: "💣", bet: 5 },
  { name: "🚀 Spaceman", icon: "🚀", bet: 5 },
  { name: "🐰 Fortune Rabbit", icon: "🐰", bet: 5 },
];

// Função para verificar se é admin
function isAdmin(userId) {
  return userId === ADMIN_ID;
}

// Função para verificar se usuário está registrado
function isRegistered(userId) {
  return db.users[userId] !== undefined;
}

// Função para criar keyboard inline atraente
function createMainKeyboard(userId) {
  const user = db.users[userId];
  const keyboard = [];

  // Linha 1: Saldo e Depositar
  keyboard.push([
    { text: `💰 Saldo: R$ ${user.balance.toFixed(2)}`, callback_data: "saldo" },
    { text: "💳 Depositar", callback_data: "depositar" },
  ]);

  // Linha 2: Jogar e Resgatar Gift
  keyboard.push([
    { text: "🎮 JOGAR AGORA", callback_data: "jogar" },
    { text: "🎁 Resgatar Gift", callback_data: "resgatar_gift" },
  ]);

  // Linha 3: Suporte
  keyboard.push([
    { text: "📊 Histórico", callback_data: "historico" },
    { text: "❓ Ajuda", callback_data: "ajuda" },
  ]);

  return keyboard;
}

// Função para criar teclado de jogos
function createGamesKeyboard() {
  const keyboard = [];

  // Adicionar jogos populares
  keyboard.push([
    { text: "💣 Mines", callback_data: "game_mines" },
    { text: "🐯 Fortune Tiger", callback_data: "game_fortune" },
  ]);

  keyboard.push([
    { text: "✈️ Aviator", callback_data: "game_aviator" },
    { text: "⚡ Gates of Olympus", callback_data: "game_gates" },
  ]);

  keyboard.push([
    { text: "🃏 Blackjack", callback_data: "game_blackjack" },
    { text: "🚀 Spaceman", callback_data: "game_spaceman" },
  ]);

  keyboard.push([{ text: "🔙 Voltar", callback_data: "voltar_menu" }]);

  return keyboard;
}

// Função para criar tabuleiro do Mines
function createMinesBoard(userId, revealed = []) {
  const keyboard = [];
  const game = db.minesGames[userId];

  for (let i = 0; i < 5; i++) {
    const row = [];
    for (let j = 0; j < 5; j++) {
      const pos = i * 5 + j;
      let emoji = "⬜";

      if (revealed.includes(pos)) {
        emoji = game.bombs.includes(pos) ? "💣" : "💎";
      }

      row.push({
        text: emoji,
        callback_data: `mines_${pos}`,
      });
    }
    keyboard.push(row);
  }

  // Botão de retirar
  if (game && game.multiplier > 1) {
    keyboard.push([
      {
        text: `💰 Retirar R$ ${(game.bet * game.multiplier).toFixed(2)}`,
        callback_data: "mines_cashout",
      },
    ]);
  }

  keyboard.push([{ text: "❌ Sair do Jogo", callback_data: "mines_exit" }]);

  return keyboard;
}

// Comando /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // Verificar modo manutenção
  if (db.maintenance && !isAdmin(userId)) {
    return bot.sendMessage(
      chatId,
      "🔧 *Bot em atualização!*\n\nLogo voltamos, estamos adicionando novos jogos. Fique atento! ⚡",
      { parse_mode: "Markdown" },
    );
  }

  // Verificar se está bloqueado
  if (db.users[userId]?.blocked) {
    return bot.sendMessage(chatId, "🚫 Você foi bloqueado de usar este bot.");
  }

  // Verificar se está banido
  if (db.users[userId]?.banned) {
    return bot.sendMessage(chatId, "⛔ Você foi banido do casino.");
  }

  // Se não está registrado, iniciar cadastro
  if (!isRegistered(userId)) {
    bot.sendMessage(
      chatId,
      "🎰 *BEM-VINDO AO CASINO BRASIL DA SORTE!* 🎰\n\n✨ O melhor casino online do Brasil!\n\n📝 Por favor, me envie seu nome para completar o cadastro:",
      { parse_mode: "Markdown" },
    );

    db.awaitingMessage[userId] = {
      type: "cadastro",
      callback: (response) => {
        if (response.text && !response.text.startsWith("/")) {
          const userName = response.text;

          // Criar usuário
          db.users[userId] = {
            name: userName,
            balance: 0,
            id: userId,
            banned: false,
            blocked: false,
            history: [],
          };

          bot.sendMessage(
            chatId,
            `✅ *Cadastro realizado com sucesso!*\n\n👤 Nome: ${userName}\n🆔 ID: ${userId}\n💰 Saldo: R$ 0.00\n\n🎉 Ganhe R$ 5.00 de bônus de boas-vindas!\n\nUse /start novamente para acessar o casino!`,
            { parse_mode: "Markdown" },
          );

          // Bônus de boas-vindas
          db.users[userId].balance = 5.0;
          delete db.awaitingMessage[userId];
        }
      },
    };
    return;
  }

  // Mostrar mídia de início se configurada
  if (db.startMedia) {
    if (db.startMedia.type === "photo") {
      await bot.sendPhoto(chatId, db.startMedia.fileId);
    } else if (db.startMedia.type === "video") {
      await bot.sendVideo(chatId, db.startMedia.fileId);
    }
  }

  // Mostrar menu principal com interface atraente
  const user = db.users[userId];
  let message = `🎰 *CASINO BRASIL DA SORTE* 🎰\n\n`;
  message += `━━━━━━━━━━━━━━━━━━━━\n`;
  message += `👤 *${user.name}*\n`;
  message += `🆔 ID: \`${user.id}\`\n`;
  message += `💰 Saldo: *R$ ${user.balance.toFixed(2)}*\n`;
  message += `━━━━━━━━━━━━━━━━━━━━\n\n`;
  message += `🎮 *${games.length} JOGOS DISPONÍVEIS!*\n\n`;
  message += `🔥 Fortune Tiger\n`;
  message += `💎 Gates of Olympus\n`;
  message += `✈️ Aviator\n`;
  message += `🃏 Blackjack\n`;
  message += `🚀 E muito mais...\n\n`;
  message += `━━━━━━━━━━━━━━━━━━━━\n`;
  message += `💡 *Clique em "JOGAR AGORA" para começar!*`;

  bot.sendMessage(chatId, message, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: createMainKeyboard(userId) },
  });
});

// Handler de mensagens para aguardar respostas
bot.on("message", (msg) => {
  const userId = msg.from.id;

  if (db.awaitingMessage[userId]) {
    db.awaitingMessage[userId].callback(msg);
  }
});

// Callbacks do bot
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;

  // Broadcast handlers
  if (data === "broadcast_yes" && isAdmin(userId) && db.tempBroadcast) {
    const broadcastMsg = db.tempBroadcast;
    let sent = 0;

    for (const uid in db.users) {
      try {
        if (broadcastMsg.text) {
          await bot.sendMessage(uid, broadcastMsg.text);
        } else if (broadcastMsg.photo) {
          await bot.sendPhoto(
            uid,
            broadcastMsg.photo[broadcastMsg.photo.length - 1].file_id,
            {
              caption: broadcastMsg.caption,
            },
          );
        } else if (broadcastMsg.video) {
          await bot.sendVideo(uid, broadcastMsg.video.file_id, {
            caption: broadcastMsg.caption,
          });
        }
        sent++;
      } catch (error) {
        console.error(`Erro ao enviar para ${uid}:`, error);
      }
    }

    bot.answerCallbackQuery(query.id);
    bot.sendMessage(chatId, `✅ Mensagem enviada para ${sent} usuários!`);
    delete db.tempBroadcast;
    return;
  }

  if (data === "broadcast_no" && isAdmin(userId)) {
    bot.answerCallbackQuery(query.id);
    bot.sendMessage(chatId, "❌ Transmissão cancelada.");
    delete db.tempBroadcast;
    return;
  }

  // Saldo
  if (data === "saldo") {
    const user = db.users[userId];
    bot.answerCallbackQuery(query.id, {
      text: `💰 Seu saldo: R$ ${user.balance.toFixed(2)}`,
      show_alert: true,
    });
    return;
  }

  // Depositar
  if (data === "depositar") {
    bot.answerCallbackQuery(query.id);
    bot.sendMessage(
      chatId,
      "💳 *FAZER DEPÓSITO*\n\nEnvie o valor que deseja depositar:\n\nExemplo: `20` para depositar R$ 20,00\n\n💎 Depósito mínimo: R$ 1,00" +
        (db.doubleBalance
          ? "\n\n🎉 *DOBRO ATIVO!* Você receberá o dobro do valor!"
          : ""),
      {
        parse_mode: "Markdown",
      },
    );

    db.awaitingMessage[userId] = {
      type: "deposito",
      callback: async (response) => {
        const amount = parseFloat(response.text);

        if (isNaN(amount) || amount < 1) {
          bot.sendMessage(
            chatId,
            "❌ Valor inválido! Digite um valor maior que R$ 1,00",
          );
          return;
        }

        try {
          const webhookUrl = process.env.REPLIT_DEV_DOMAIN
            ? `https://${process.env.REPLIT_DEV_DOMAIN}/webhook`
            : `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co/webhook`;

          const preferenceData = {
            items: [
              {
                title: "Depósito Casino",
                quantity: 1,
                unit_price: amount,
                currency_id: "BRL",
              },
            ],
            payment_methods: {
              excluded_payment_types: [
                { id: "credit_card" },
                { id: "debit_card" },
              ],
            },
            external_reference: userId.toString(),
            notification_url: webhookUrl,
          };

          const result = await preference.create({ body: preferenceData });

          let message = `💳 *DEPÓSITO VIA PIX*\n\n`;
          message += `💰 Valor: R$ ${amount.toFixed(2)}\n`;

          if (db.doubleBalance) {
            message += `🎉 Você receberá: R$ ${(amount * 2).toFixed(2)}\n`;
          }

          message += `\n⏱️ Pagamento será confirmado automaticamente!\n`;
          message += `\n🔗 Link de pagamento:\n${result.init_point}`;

          bot.sendMessage(chatId, message, {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "💳 Pagar agora", url: result.init_point }],
              ],
            },
          });

          db.payments[result.id] = userId;
          delete db.awaitingMessage[userId];
        } catch (error) {
          console.error("Erro ao criar pagamento:", error);
          bot.sendMessage(
            chatId,
            "❌ Erro ao gerar pagamento. Tente novamente mais tarde.",
          );
          delete db.awaitingMessage[userId];
        }
      },
    };
    return;
  }

  // Resgatar gift
  if (data === "resgatar_gift") {
    bot.answerCallbackQuery(query.id);
    bot.sendMessage(
      chatId,
      "🎁 *RESGATAR GIFT CARD*\n\nEnvie o código do gift para resgatar:",
      { parse_mode: "Markdown" },
    );

    db.awaitingMessage[userId] = {
      type: "gift",
      callback: (response) => {
        const giftCode = response.text.trim().toUpperCase();

        if (!db.gifts[giftCode]) {
          bot.sendMessage(
            chatId,
            "❌ Código de gift inválido ou já utilizado!",
          );
          delete db.awaitingMessage[userId];
          return;
        }

        const amount = db.gifts[giftCode];
        db.users[userId].balance += amount;
        delete db.gifts[giftCode];

        bot.sendMessage(
          chatId,
          `🎁 *Gift resgatado com sucesso!*\n\n💰 + R$ ${amount.toFixed(2)}\n💵 Saldo atual: R$ ${db.users[userId].balance.toFixed(2)}`,
          { parse_mode: "Markdown" },
        );
        delete db.awaitingMessage[userId];
      },
    };
    return;
  }

  // Histórico
  if (data === "historico") {
    bot.answerCallbackQuery(query.id);
    bot.sendMessage(
      chatId,
      "📊 *HISTÓRICO*\n\nEm breve você poderá ver todo seu histórico de jogos e transações aqui!",
      { parse_mode: "Markdown" },
    );
    return;
  }

  // Ajuda
  if (data === "ajuda") {
    bot.answerCallbackQuery(query.id);
    let helpMsg = `❓ *AJUDA*\n\n`;
    helpMsg += `📌 *Como depositar:*\nClique em "Depositar" e siga as instruções\n\n`;
    helpMsg += `📌 *Como jogar:*\nClique em "JOGAR AGORA" e escolha seu jogo favorito\n\n`;
    helpMsg += `📌 *Como resgatar gift:*\nClique em "Resgatar Gift" e digite o código\n\n`;
    helpMsg += `📌 *Suporte:*\nFale com @admin para tirar dúvidas`;

    bot.sendMessage(chatId, helpMsg, { parse_mode: "Markdown" });
    return;
  }

  // Jogar - Mostrar lista de jogos
  if (data === "jogar") {
    bot.answerCallbackQuery(query.id);
    bot.editMessageText(
      `🎮 *ESCOLHA SEU JOGO*\n\n💎 Selecione um dos jogos abaixo:`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: createGamesKeyboard() },
      },
    );
    return;
  }

  // Voltar ao menu
  if (data === "voltar_menu") {
    bot.answerCallbackQuery(query.id);
    const user = db.users[userId];
    let message = `🎰 *CASINO BRASIL DA SORTE* 🎰\n\n`;
    message += `━━━━━━━━━━━━━━━━━━━━\n`;
    message += `👤 *${user.name}*\n`;
    message += `🆔 ID: \`${user.id}\`\n`;
    message += `💰 Saldo: *R$ ${user.balance.toFixed(2)}*\n`;
    message += `━━━━━━━━━━━━━━━━━━━━\n\n`;
    message += `💡 *Clique em "JOGAR AGORA" para começar!*`;

    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: createMainKeyboard(userId) },
    });
    return;
  }

  // Iniciar jogo Mines
  if (data === "game_mines") {
    bot.answerCallbackQuery(query.id);

    if (db.users[userId].balance < 5) {
      bot.answerCallbackQuery(query.id, {
        text: "❌ Saldo insuficiente! Depósito mínimo: R$ 5,00",
        show_alert: true,
      });
      return;
    }

    // Descontar aposta
    db.users[userId].balance -= 5;

    // Criar jogo de Mines
    const bombs = [];
    while (bombs.length < 5) {
      const pos = Math.floor(Math.random() * 25);
      if (!bombs.includes(pos)) {
        bombs.push(pos);
      }
    }

    db.minesGames[userId] = {
      board: Array(25).fill(null),
      revealed: [],
      bombs: bombs,
      bet: 5,
      multiplier: 1,
      gemsFound: 0,
    };

    let message = `💣 *MINES*\n\n`;
    message += `💰 Aposta: R$ 5.00\n`;
    message += `💎 Encontre as gemas!\n`;
    message += `💣 Evite as 5 bombas!\n\n`;
    message += `📊 Gemas encontradas: 0\n`;
    message += `📈 Multiplicador: 1.00x`;

    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: createMinesBoard(userId, []) },
    });
    return;
  }

  // Revelar célula do Mines
  if (
    data.startsWith("mines_") &&
    !data.includes("cashout") &&
    !data.includes("exit")
  ) {
    const pos = parseInt(data.split("_")[1]);
    const game = db.minesGames[userId];

    if (!game) {
      bot.answerCallbackQuery(query.id, {
        text: "❌ Jogo não encontrado! Inicie um novo jogo.",
        show_alert: true,
      });
      return;
    }

    if (game.revealed.includes(pos)) {
      bot.answerCallbackQuery(query.id, {
        text: "⚠️ Você já clicou aqui!",
      });
      return;
    }

    game.revealed.push(pos);

    // Verificar se é bomba
    if (game.bombs.includes(pos)) {
      bot.answerCallbackQuery(query.id, {
        text: "💥 BOOM! Você perdeu!",
        show_alert: true,
      });

      let message = `💣 *GAME OVER!*\n\n`;
      message += `💥 Você encontrou uma bomba!\n`;
      message += `💰 Perdeu: R$ 5.00\n\n`;
      message += `💵 Saldo atual: R$ ${db.users[userId].balance.toFixed(2)}`;

      // Revelar todas as bombas
      bot.editMessageText(message, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🎮 Jogar Novamente", callback_data: "game_mines" }],
            [{ text: "🔙 Voltar", callback_data: "voltar_menu" }],
          ],
        },
      });

      delete db.minesGames[userId];
      return;
    }

    // É uma gema!
    game.gemsFound++;
    game.multiplier = 1 + game.gemsFound * 0.3;

    bot.answerCallbackQuery(query.id, {
      text: `💎 Gema encontrada! +${(game.multiplier - 1).toFixed(2)}x`,
    });

    let message = `💣 *MINES*\n\n`;
    message += `💰 Aposta: R$ 5.00\n`;
    message += `💎 Encontre as gemas!\n`;
    message += `💣 Evite as 5 bombas!\n\n`;
    message += `📊 Gemas encontradas: ${game.gemsFound}\n`;
    message += `📈 Multiplicador: ${game.multiplier.toFixed(2)}x\n`;
    message += `💰 Ganho atual: R$ ${(game.bet * game.multiplier).toFixed(2)}`;

    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: createMinesBoard(userId, game.revealed),
      },
    });
    return;
  }

  // Retirar ganhos do Mines
  if (data === "mines_cashout") {
    const game = db.minesGames[userId];

    if (!game) {
      bot.answerCallbackQuery(query.id, {
        text: "❌ Jogo não encontrado!",
        show_alert: true,
      });
      return;
    }

    const winAmount = game.bet * game.multiplier;
    db.users[userId].balance += winAmount;

    bot.answerCallbackQuery(query.id, {
      text: `✅ Você ganhou R$ ${winAmount.toFixed(2)}!`,
      show_alert: true,
    });

    let message = `🎉 *VITÓRIA!*\n\n`;
    message += `💎 Gemas encontradas: ${game.gemsFound}\n`;
    message += `📈 Multiplicador: ${game.multiplier.toFixed(2)}x\n`;
    message += `💰 Ganhou: R$ ${winAmount.toFixed(2)}\n\n`;
    message += `💵 Saldo atual: R$ ${db.users[userId].balance.toFixed(2)}`;

    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🎮 Jogar Novamente", callback_data: "game_mines" }],
          [{ text: "🔙 Voltar", callback_data: "voltar_menu" }],
        ],
      },
    });

    delete db.minesGames[userId];
    return;
  }

  // Sair do Mines
  if (data === "mines_exit") {
    const game = db.minesGames[userId];

    if (game) {
      bot.answerCallbackQuery(query.id, {
        text: "Você saiu do jogo e perdeu a aposta.",
        show_alert: true,
      });
      delete db.minesGames[userId];
    } else {
      bot.answerCallbackQuery(query.id);
    }

    bot.editMessageText(
      `🎮 *ESCOLHA SEU JOGO*\n\n💎 Selecione um dos jogos abaixo:`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: createGamesKeyboard() },
      },
    );
    return;
  }

  // Outros jogos (simulação básica)
  if (data.startsWith("game_")) {
    bot.answerCallbackQuery(query.id);
    const gameName = data.replace("game_", "");

    if (db.users[userId].balance < 5) {
      bot.answerCallbackQuery(query.id, {
        text: "❌ Saldo insuficiente! Depósito mínimo: R$ 5,00",
        show_alert: true,
      });
      return;
    }

    db.users[userId].balance -= 5;
    const win = Math.random() > 0.4;
    const multiplier = win ? (1 + Math.random() * 3).toFixed(2) : 0;
    const prize = win ? (5 * multiplier).toFixed(2) : 0;

    if (win) {
      db.users[userId].balance += parseFloat(prize);
    }

    const gameNames = {
      fortune: "🐯 Fortune Tiger",
      aviator: "✈️ Aviator",
      gates: "⚡ Gates of Olympus",
      blackjack: "🃏 Blackjack",
      spaceman: "🚀 Spaceman",
    };

    let message = win
      ? `🎉 *VOCÊ GANHOU!*\n\n🎮 ${gameNames[gameName]}\n💰 Aposta: R$ 5.00\n📈 Multiplicador: ${multiplier}x\n💎 Prêmio: R$ ${prize}\n\n💵 Saldo: R$ ${db.users[userId].balance.toFixed(2)}`
      : `😔 *NÃO FOI DESSA VEZ!*\n\n🎮 ${gameNames[gameName]}\n💰 Perdeu: R$ 5.00\n\n💵 Saldo: R$ ${db.users[userId].balance.toFixed(2)}`;

    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔄 Jogar Novamente", callback_data: data }],
          [{ text: "🎮 Outros Jogos", callback_data: "jogar" }],
          [{ text: "🔙 Menu Principal", callback_data: "voltar_menu" }],
        ],
      },
    });
    return;
  }

  // Comandos de admin
  if (data === "toggle_maintenance" && isAdmin(userId)) {
    db.maintenance = !db.maintenance;
    bot.answerCallbackQuery(query.id, {
      text: `Manutenção ${db.maintenance ? "ativada" : "desativada"}!`,
    });
    return;
  }

  if (data === "toggle_double" && isAdmin(userId)) {
    db.doubleBalance = !db.doubleBalance;
    bot.answerCallbackQuery(query.id, {
      text: `Saldo em dobro ${db.doubleBalance ? "ativado" : "desativado"}!`,
    });
    return;
  }
});

// Webhook do Mercado Pago
app.post("/webhook", async (req, res) => {
  try {
    const { type, data } = req.body;

    if (type === "payment") {
      const paymentId = data.id;
      const paymentInfo = await payment.get({ id: paymentId });

      if (paymentInfo.status === "approved") {
        const userId = parseInt(paymentInfo.external_reference);
        let amount = paymentInfo.transaction_amount;

        if (db.doubleBalance) {
          amount *= 2;
        }

        if (db.users[userId]) {
          db.users[userId].balance += amount;

          bot.sendMessage(
            userId,
            `✅ *Pagamento confirmado!*\n\n💰 R$ ${amount.toFixed(2)} adicionado ao seu saldo!\n\n💵 Saldo atual: R$ ${db.users[userId].balance.toFixed(2)}`,
            { parse_mode: "Markdown" },
          );
        }
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Erro no webhook:", error);
    res.sendStatus(500);
  }
});

// Interface Web do Casino
app.get("/casino", (req, res) => {
  const userId = req.query.user;
  const user = db.users[userId];

  if (!user) {
    return res.send("<h1>Usuário não encontrado</h1>");
  }

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Casino Brasil da Sorte</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        
        .header {
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            padding: 20px;
            border-radius: 15px;
            margin-bottom: 20px;
            color: white;
            text-align: center;
        }
        
        .balance {
            font-size: 32px;
            font-weight: bold;
            margin: 10px 0;
        }
        
        .games-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
            gap: 20px;
        }
        
        .game-card {
            background: rgba(255, 255, 255, 0.95);
            border-radius: 15px;
            padding: 20px;
            text-align: center;
            cursor: pointer;
            transition: transform 0.3s, box-shadow 0.3s;
            position: relative;
            overflow: hidden;
        }
        
        .game-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        }
        
        .game-icon {
            font-size: 64px;
            margin: 10px 0;
        }
        
        .game-name {
            font-size: 18px;
            font-weight: bold;
            margin: 10px 0;
            color: #333;
        }
        
        .game-bet {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 10px 20px;
            border-radius: 25px;
            margin-top: 10px;
            display: inline-block;
        }
        
        .play-btn {
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            color: white;
            border: none;
            padding: 12px 30px;
            border-radius: 25px;
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
            margin-top: 10px;
            transition: transform 0.2s;
        }
        
        .play-btn:hover {
            transform: scale(1.05);
        }
        
        .user-info {
            font-size: 14px;
            opacity: 0.9;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎰 CASINO BRASIL DA SORTE 🎰</h1>
            <div class="user-info">👤 ${user.name} | 🆔 ${user.id}</div>
            <div class="balance">💰 R$ ${user.balance.toFixed(2)}</div>
        </div>
        
        <div class="games-grid">
            ${games
              .map(
                (game) => `
                <div class="game-card" onclick="playGame('${game.name}', ${game.bet}, ${userId})">
                    <div class="game-icon">${game.icon}</div>
                    <div class="game-name">${game.name}</div>
                    <div class="game-bet">Aposta: R$ ${game.bet.toFixed(2)}</div>
                    <button class="play-btn">JOGAR AGORA</button>
                </div>
            `,
              )
              .join("")}
        </div>
    </div>
    
    <script>
        function playGame(gameName, bet, userId) {
            if (${user.balance} < bet) {
                alert('❌ Saldo insuficiente! Faça um depósito para jogar.');
                return;
            }
            
            const win = Math.random() > 0.5;
            const multiplier = (Math.random() * 3 + 0.5).toFixed(2);
            const prize = win ? (bet * multiplier).toFixed(2) : 0;
            
            if (win) {
                alert('🎉 VOCÊ GANHOU! \\n\\n💰 Prêmio: R$ ' + prize + '\\n\\nO valor será creditado em sua conta!');
            } else {
                alert('😔 Não foi dessa vez!\\n\\nTente novamente!');
            }
        }
    </script>
</body>
</html>
  `;

  res.send(html);
});



bot.onText(/\/ft/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAdmin(userId)) {
    return bot.sendMessage(
      chatId,
      "⛔ Comando disponível apenas para administradores.",
    );
  }

  bot.sendMessage(
    chatId,
    "📸 Envie uma foto ou vídeo para configurar a tela inicial:",
  );

  db.awaitingMessage[userId] = {
    type: "ft",
    callback: (response) => {
      if (response.photo) {
        db.startMedia = {
          type: "photo",
          fileId: response.photo[response.photo.length - 1].file_id,
        };
        bot.sendMessage(chatId, "✅ Foto de início configurada com sucesso!");
      } else if (response.video) {
        db.startMedia = {
          type: "video",
          fileId: response.video.file_id,
        };
        bot.sendMessage(chatId, "✅ Vídeo de início configurado com sucesso!");
      }
      delete db.awaitingMessage[userId];
    },
  };
});

bot.onText(/\/ms/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAdmin(userId)) {
    return bot.sendMessage(
      chatId,
      "⛔ Comando disponível apenas para administradores.",
    );
  }

  bot.sendMessage(
    chatId,
    "📢 Envie a mensagem, foto ou vídeo para transmitir a todos os usuários:",
  );

  db.awaitingMessage[userId] = {
    type: "broadcast",
    callback: async (response) => {
      await bot.sendMessage(
        chatId,
        "❓ Posso enviar esta mensagem para todos os usuários?",
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Sim", callback_data: "broadcast_yes" },
                { text: "❌ Não", callback_data: "broadcast_no" },
              ],
            ],
          },
        },
      );

      db.tempBroadcast = response;
      delete db.awaitingMessage[userId];
    },
  };
});

bot.onText(/\/gift (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const amount = parseFloat(match[1]);

  if (!isAdmin(userId)) {
    return bot.sendMessage(
      chatId,
      "⛔ Comando disponível apenas para administradores.",
    );
  }

  if (isNaN(amount) || amount <= 0) {
    return bot.sendMessage(
      chatId,
      "❌ Valor inválido! Use: /gift [valor]\nExemplo: /gift 50",
    );
  }

  const giftCode =
    "GIFT" + Math.random().toString(36).substring(2, 10).toUpperCase();
  db.gifts[giftCode] = amount;

  bot.sendMessage(
    chatId,
    `🎁 *Gift criado com sucesso!*\n\n💰 Valor: R$ ${amount.toFixed(2)}\n🔑 Código: \`${giftCode}\`\n\nOs usuários podem resgatar com o código acima.`,
    { parse_mode: "Markdown" },
  );
});

bot.onText(/\/painel/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAdmin(userId)) {
    return bot.sendMessage(
      chatId,
      "⛔ Comando disponível apenas para administradores.",
    );
  }

  const totalUsers = Object.keys(db.users).length;
  let totalBalance = 0;

  Object.values(db.users).forEach((user) => {
    totalBalance += user.balance;
  });

  let message = `👑 *PAINEL DE ADMINISTRAÇÃO*\n\n`;
  message += `👥 Total de usuários: ${totalUsers}\n`;
  message += `💰 Saldo total: R$ ${totalBalance.toFixed(2)}\n\n`;
  message += `🔧 Manutenção: ${db.maintenance ? "✅ Ativada" : "❌ Desativada"}\n`;
  message += `💎 Saldo em dobro: ${db.doubleBalance ? "✅ Ativado" : "❌ Desativado"}`;

  const buttons = [
    [
      {
        text: db.maintenance
          ? "🔓 Desativar Manutenção"
          : "🔒 Ativar Manutenção",
        callback_data: "toggle_maintenance",
      },
    ],
    [
      {
        text: db.doubleBalance ? "💎 Desativar Dobro" : "💎 Ativar Dobro",
        callback_data: "toggle_double",
      },
    ],
  ];

  bot.sendMessage(chatId, message, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: buttons },
  });
});

// Configurar webhook do Telegram
const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;

app.get("/", (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Casino Brasil da Sorte</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            text-align: center;
          }
          .container {
            background: rgba(255, 255, 255, 0.1);
            padding: 40px;
            border-radius: 20px;
            backdrop-filter: blur(10px);
          }
          h1 { font-size: 48px; margin: 0; }
          p { font-size: 20px; margin: 20px 0; }
          .status { 
            background: #4CAF50; 
            padding: 10px 20px; 
            border-radius: 10px; 
            display: inline-block;
            margin-top: 20px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🎰 Casino Brasil da Sorte 🎰</h1>
          <p>Bot Telegram de Casino Online</p>
          <div class="status">✅ Bot Online</div>
        </div>
      </body>
    </html>
  `);
});

app.post(/^\/bot.+$/, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.listen(PORT, "0.0.0.0", async () => {
  console.log(`🚀 Bot iniciado!`);
  console.log(`📡 Servidor rodando na porta ${PORT}`);
  console.log(`🌐 URL: ${WEBHOOK_URL}`);

  try {
    const webhookUrl = `${WEBHOOK_URL}/bot${BOT_TOKEN}`;
    await bot.setWebHook(webhookUrl);
    console.log(`✅ Webhook configurado: ${webhookUrl}`);

    const webhookInfo = await bot.getWebHookInfo();
    console.log(`📋 Status do webhook:`, webhookInfo);
  } catch (error) {
    console.error("❌ Erro ao configurar webhook:", error);
  }

  console.log(`🤖 Bot pronto para receber comandos!`);
});
// Iniciar bot em modo polling
bot.startPolling();
console.log("🤖 Bot rodando em modo polling!");