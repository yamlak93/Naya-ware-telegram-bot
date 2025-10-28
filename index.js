// === IMPORTS ===
// NOTE: Make sure you have the 'dotenv' package installed if using a local .env file
require('dotenv').config(); 
const { Telegraf, Markup } = require('telegraf');

// === ENVIRONMENT CONFIG ===
// Read values from environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = process.env.ADMIN_IDS
    ? process.env.ADMIN_IDS.split(',').map(id => Number(id.trim()))
    : [];

// === VALIDATION ===
if (!BOT_TOKEN) {
    console.error('❌ ERROR: BOT_TOKEN not found. Please add it in .env or environment settings.');
    // Exit gracefully if the token is missing
    process.exit(1);
}

// Initialize the bot
const bot = new Telegraf(BOT_TOKEN);

// === WELCOME MESSAGE ===
const WELCOME_MESSAGE = `👋 Welcome to *NAYA wear*! ✨
We are around Ledeta Flint Stone Homes.

We design elegant, high-quality fashion pieces made just for you.
Please note: all custom orders take *5–7 days* to complete.

---
*Payment Confirmation*
To confirm your order, we kindly ask for a small advance payment.
Only *200 birr*
Payment Account Number: CBE \`1000495773268\` Yanet Tariku Biruk

Once payment is complete, please use the *Upload Receipt* button to send your bank slip screenshot.
---

Click the *Place New Custom Order* button to start your request!`;

// === QUESTIONS ===
const QUESTIONS = {
    q1: '*Question 1:* What would you like to order? (e.g. dress, suit, pants, top, or custom design)',
    q2: '*Question 2:* 📏 Please share your size or measurements. (small, medium, large, XL, etc.)',
    q3: '*Question 3:* 🎨 What color or fabric do you prefer?',
    q4: '*Question 4:* 📸 Would you like to send a reference photo? (optional - you can upload it here or type "skip")',
    q5: '*Question 5:* 📞 Please share your phone number so we can confirm your order.'
};

// === SESSION MANAGEMENT ===
// { [chatId]: { stage: 'awaiting_q1' | 'awaiting_receipt_phone' | ..., data: {} } }
let userSessions = {};
let orders = {};
let orderIdCounter = 1;

// === HELPER FUNCTIONS ===

/**
 * Safely wraps user-provided text in Markdown inline code blocks.
 * This prevents special Markdown characters from breaking the formatting.
 */
const wrapUserInput = (text) => '`' + String(text).replace(/`/g, "'") + '`';

/**
 * Advances the user's state and asks the next question.
 */
async function transitionState(ctx, currentStage) {
    const chatId = ctx.chat.id;
    let nextStage;
    let replyOptions = {};

    switch (currentStage) {
        case 'q1':
            nextStage = 'awaiting_q2';
            ctx.reply(QUESTIONS.q2, { parse_mode: 'Markdown' });
            break;
        case 'q2':
            nextStage = 'awaiting_q3';
            ctx.reply(QUESTIONS.q3, { parse_mode: 'Markdown' });
            break;
        case 'q3':
            nextStage = 'awaiting_photo';
            // Provide a button to easily skip the photo step
            replyOptions = {
                reply_markup: Markup.inlineKeyboard([
                    Markup.button.callback('➡️ Skip Photo', 'skip_photo')
                ])
            };
            ctx.reply(QUESTIONS.q4, { parse_mode: 'Markdown', ...replyOptions });
            break;
        case 'photo_received': // Photo received or skipped
            nextStage = 'awaiting_phone';
            ctx.reply(QUESTIONS.q5, { parse_mode: 'Markdown' });
            break;
        case 'q5':
            nextStage = 'finalized';
            await finalizeOrder(ctx);
            break;
        default:
            nextStage = 'idle';
            ctx.reply("Something went wrong with the order flow. Please use the '📦 Place New Custom Order' button to restart.");
    }
    if (userSessions[chatId] && nextStage !== 'finalized') {
        userSessions[chatId].stage = nextStage;
    }
}

/**
 * Handles the completion and notification for a payment receipt upload.
 */
async function finalizeReceipt(ctx, session, fileId) {
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name;
    const phone = session.receipt_phone;

    for (const adminId of ADMIN_IDS) {
        try {
            // Sending as plain text (no parse_mode) for robust receipt handling
            await ctx.telegram.sendPhoto(adminId, fileId, {
                caption: `💰 NEW PAYMENT RECEIPT RECEIVED 💰
Customer: ${username} (ID: ${userId})
Phone Number (for verification): ${phone}
---
ACTION REQUIRED: Please check bank account (1000495773268) to verify the 200 birr advance payment.`,
            });
        } catch (error) {
            console.error(`[RECEIPT ERROR] Failed to send receipt photo to admin ID ${adminId}. Reason:`, error.message);
            const fallbackText = `⚠️ FAILED to display payment receipt photo for user ${username} (ID: ${userId}). 
Phone: ${phone}. File ID: ${fileId}.`;
            ctx.telegram.sendMessage(adminId, fallbackText); 
        }
    }
    
    // Notify user
    ctx.reply('✅ Receipt uploaded successfully! Thank you for confirming your advance payment.');
    
    // Clear receipt session
    delete userSessions[ctx.chat.id];
}


// === ORDER FINALIZATION (Restored and fixed to use plain text for robustness) ===
async function finalizeOrder(ctx) {
    const chatId = ctx.chat.id;
    const session = userSessions[chatId];
    const newOrderId = orderIdCounter++;

    const finalOrder = {
        id: newOrderId,
        userId: ctx.from.id,
        username: ctx.from.username || ctx.from.first_name,
        q1_order: session.q1_order,
        q2_size: session.q2_size,
        q3_color: session.q3_color,
        q4_photo_file_id: session.q4_photo_file_id || 'N/A',
        q5_phone: session.q5_phone,
        status: 'pending'
    };

    orders[newOrderId] = finalOrder;
    delete userSessions[chatId];

    // 1. Confirmation to buyer
    ctx.reply(`✅ *Order Request Sent!* (ID: ${newOrderId})\n
Thank you for your request. We will review your order soon.
*Reminder:* Please ensure you have uploaded your *payment receipt*.`,
        { parse_mode: 'Markdown' }
    );

    // 2. Admin Notification (CRITICAL: Using plain text for captions/messages for stability)
    const adminMessage = `🚨 NEW CUSTOM ORDER PENDING (ID: ${newOrderId}) 🚨
Customer: ${ctx.from.first_name} (@${ctx.from.username || 'N/A'})
User ID: ${finalOrder.userId}
---
1. Order Type: ${wrapUserInput(finalOrder.q1_order)}
2. Size/Measurements: ${wrapUserInput(finalOrder.q2_size)}
3. Color/Fabric: ${wrapUserInput(finalOrder.q3_color)}
5. Phone Number: ${wrapUserInput(finalOrder.q5_phone)}
Photo ID: ${wrapUserInput(finalOrder.q4_photo_file_id)}`;

    const keyboard = {
        reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('✅ Accept & Process Order', `accept_order_${newOrderId}`)],
            [Markup.button.callback('❌ Reject Order (Not Implemented)', 'reject_order')]
        ])
    };

    const hasPhoto = finalOrder.q4_photo_file_id !== 'N/A' && finalOrder.q4_photo_file_id !== 'Skipped by user (text)';

    for (const adminId of ADMIN_IDS) {
        if (hasPhoto) {
            try {
                // Send photo with plain text caption
                await ctx.telegram.sendPhoto(adminId, finalOrder.q4_photo_file_id, {
                    caption: adminMessage,
                    ...keyboard 
                });
            } catch (error) {
                console.error(`Failed to send order photo with details to admin ${adminId}. Falling back to text:`, error);
                const fallbackWarning = `⚠️ Failed to display photo for Order ${newOrderId}. Photo File ID: ${finalOrder.q4_photo_file_id}\n\n`;
                // Send text fallback (no parse_mode)
                await ctx.telegram.sendMessage(adminId, fallbackWarning + adminMessage, keyboard);
            }
        } else {
            // Send text only (no parse_mode)
            ctx.telegram.sendMessage(adminId, adminMessage, keyboard)
                .catch(err => console.error(`Failed to send admin notification to ${adminId}:`, err));
        }
    }
}


// === BOT HANDLERS ===

// 1. Global Error Handler
bot.catch((err, ctx) => {
    console.error(`[Global Bot Error] for ${ctx.updateType}:`, err.message || err);
    if (ctx.chat && ctx.chat.id) {
        ctx.reply('⚠️ Oops! I ran into an unexpected error. Please try again or use the main menu buttons.', {
            parse_mode: 'Markdown'
        }).catch(replyErr => console.error("Failed to send error message back to user:", replyErr));
    }
});


// 2. Start command/Main Menu
bot.start((ctx) => {
    ctx.reply(WELCOME_MESSAGE, {
        parse_mode: 'Markdown',
        ...Markup.keyboard([
            ['📦 Place New Custom Order', '🖼️ Upload Receipt'], 
        ]).resize()
    });
});

// 3. Handle 'Place New Custom Order'
bot.hears('📦 Place New Custom Order', (ctx) => {
    userSessions[ctx.chat.id] = { stage: 'awaiting_q1' };
    ctx.reply(QUESTIONS.q1, { parse_mode: 'Markdown' });
});

// 4. Handle 'Upload Receipt'
bot.hears('🖼️ Upload Receipt', (ctx) => {
    const chatId = ctx.chat.id;
    userSessions[chatId] = { stage: 'awaiting_receipt_phone' };
    ctx.reply('To verify your payment, please first share the *phone number* associated with your order:',
        { parse_mode: 'Markdown' }
    );
});


// 5. Handle Inline Button Clicks (Accept/Skip Photo)
bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const chatId = ctx.chat.id;
    const session = userSessions[chatId];

    // Admin accepting an order
    if (data.startsWith('accept_order_')) {
        if (!ADMIN_IDS.includes(ctx.from.id)) {
            return ctx.answerCbQuery('❌ Only an authorized admin can accept orders.', true);
        }

        const orderId = data.split('_')[2];
        const order = orders[orderId];

        if (!order || order.status !== 'pending') {
            await ctx.editMessageText(`Order ID ${orderId} already accepted or not found.`, { parse_mode: 'Markdown' });
            return ctx.answerCbQuery('Order status updated.', true);
        }

        order.status = 'accepted';

        try {
            await ctx.telegram.sendMessage(order.userId,
                `🎉 *Good News!* Your custom order (#${orderId}) has been **ACCEPTED** by the NAYA wear team and is being processed! We will contact you at ${order.q5_phone} soon.`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error(`Could not notify user ${order.userId}:`, error);
        }

        await ctx.editMessageText(`✅ **ORDER ACCEPTED** (ID: ${orderId})
This custom order has been processed.`, { parse_mode: 'Markdown' });

        delete orders[orderId];
        ctx.answerCbQuery('Order accepted successfully!', true);
        return;
    }

    // User skipping the optional photo step (Q4)
    if (data === 'skip_photo' && session && session.stage === 'awaiting_photo') {
        session.q4_photo_file_id = 'Skipped by user (text)';
        await ctx.editMessageReplyMarkup({});
        ctx.answerCbQuery('Photo step skipped.');
        await transitionState(ctx, 'photo_received');
        return;
    }

    ctx.answerCbQuery();
});

// 6. Handle Photo Input (Q4 or Receipt)
bot.on('photo', async (ctx) => {
    const chatId = ctx.chat.id;
    const session = userSessions[chatId];

    if (!session) {
        return ctx.reply("I don't have an active session for you. Please use the menu buttons to start.");
    }
    
    // Get the file_id of the largest photo size
    const photoArray = ctx.message.photo;
    const largestPhoto = photoArray[photoArray.length - 1];
    const fileId = largestPhoto.file_id;

    // Handle Receipt Upload Flow
    if (session.stage === 'awaiting_receipt_photo') {
        await finalizeReceipt(ctx, session, fileId); 
        return;
    }

    // Handle Q4 Reference Photo Flow
    if (session.stage === 'awaiting_photo') {
        session.q4_photo_file_id = fileId;
        ctx.reply('📸 Reference photo received! Thank you.');
        transitionState(ctx, 'photo_received');
        return;
    }

    ctx.reply("Got your image! Please continue answering the questions based on the last prompt.");
});


// 7. Handle Text Input (The CRITICAL FIX)
bot.on('text', (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;
    const session = userSessions[chatId];

    // Ignore menu button presses
    if (['📦 Place New Custom Order', '🖼️ Upload Receipt'].includes(text)) {
        return;
    }

    if (!session) {
        return ctx.reply("I don't have an active session for you. Please use the menu buttons to start.");
    }

    // Process the input based on the current stage
    switch (session.stage) {
        // --- Receipt Flow ---
        case 'awaiting_receipt_phone':
            session.receipt_phone = text;
            session.stage = 'awaiting_receipt_photo';
            ctx.reply(`Thank you, we have saved the number: \`${text}\`.\n\nPlease now *upload the screenshot* of your bank receipt/slip to confirm the payment.`, { parse_mode: 'Markdown' });
            break;

        // --- Order Flow ---
        case 'awaiting_q1':
            session.q1_order = text;
            transitionState(ctx, 'q1');
            break;

        case 'awaiting_q2':
            session.q2_size = text;
            transitionState(ctx, 'q2');
            break;

        case 'awaiting_q3':
            session.q3_color = text;
            transitionState(ctx, 'q3');
            break;

        case 'awaiting_photo':
            // Allow user to type "skip" or similar to move past the photo
            const normalizedText = text.toLowerCase().trim();
            if (normalizedText === 'skip' || normalizedText.includes('no photo') || normalizedText.includes('n/a')) {
                session.q4_photo_file_id = 'Skipped by user (text)';
                ctx.reply('Photo step skipped.');
                transitionState(ctx, 'photo_received');
            } else {
                ctx.reply("Please either upload a photo or tap the '➡️ Skip Photo' button, or type 'skip' to continue.");
            }
            break;

        case 'awaiting_phone':
            session.q5_phone = text;
            transitionState(ctx, 'q5'); // This will call finalizeOrder
            break;

        default:
            ctx.reply("I'm not sure what to do with that input right now. Please continue answering the current question.");
            break;
    }
});


// === BOT LAUNCH ===
bot.launch().then(() => {
    console.log('🚀 NAYA Wear Bot is running...');
    bot.telegram.setMyCommands([
        { command: 'start', description: 'Show the welcome message and main menu' },
    ]).catch(err => console.error("Failed to set commands:", err));
});

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
