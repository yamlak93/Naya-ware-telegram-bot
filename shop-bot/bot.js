const { Telegraf, Markup } = require('telegraf');

// --- CONFIGURATION ---
// IMPORTANT: Replace with your actual bot token from BotFather
// We use 'const' for the raw token value.
const RAW_TOKEN_INPUT = '8109581729:AAELmvdzbJlEZWH1C549y_iEw6U8cu_NJok'; 
// IMPORTANT: Replace with your Telegram ID(s) (Admin). All listed IDs will receive notifications.
const ADMIN_IDS = [987002009, 8338215737];

// CRITICAL FIX: Aggressively strip any non-token character (spaces, newlines, invisible control characters)
// This ensures only the valid alphanumeric characters, colon, and hyphen remain.
// By declaring a new 'const BOT_TOKEN', we avoid the "Assignment to constant variable" error
// that you were seeing if your local file used 'const' on the initial declaration.
const BOT_TOKEN = RAW_TOKEN_INPUT.replace(/[^\w:-]/g, '').trim(); 

if (BOT_TOKEN === 'YOUR_NEW_BOT_TOKEN_HERE' || BOT_TOKEN.length < 20) {
    console.error("\n*** ERROR: Bot Token not configured correctly. The token length is suspicious. ***\n");
    // We will still initialize the bot, but it will likely fail the getMe call (expected for placeholder)
}

// Initialize the bot with the aggressively cleaned token
const bot = new Telegraf(BOT_TOKEN);

// --- MESSAGES & CONSTANTS ---

const WELCOME_MESSAGE = `👋 Welcome to *NAYA wear*! ✨
We are around ledeta flint stone homes.

We design elegant, high-quality fashion pieces made just for you.
Please note: all custom orders take *5–7 days* to complete.

---
*Payment Confirmation*
To confirm your order, we kindly ask for a small advance payment.
Only *200 birr*
Payment Account Number: \`1000495773268\` Yanet tariku biruk

Once payment is complete, please use the *Upload Receipt* button to send your bank slip screenshot.
---

Click the *Place New Custom Order* button to start your request!`;

// Questions map for easier management
const QUESTIONS = {
    q1: '*Question 1:* What you like to order? (e.g. dress, suit, pants, top, or custom design)',
    q2: '*Question 2:* 📏 Please share your size or measurements. (small, medium, large, XL, XXL, etc.)',
    q3: '*Question 3:* 🎨 What color or fabric do you prefer?',
    q4: '*Question 4:* 📸 Would you like to send a reference photo? (optional - you can upload it here or type "skip")',
    q5: '*Question 5:* 📞 Please share your phone number so we can confirm your order.'
};

// --- GLOBAL STATE MANAGEMENT (In-Memory) ---
// Stores user state during the ordering process
// { [chatId]: { stage: 'awaiting_q1' | 'awaiting_receipt_phone' | ..., data: {} } }
let userSessions = {};

// Stores confirmed orders waiting for admin approval
let orders = {};
let orderIdCounter = 1;


// --- CORE USER FLOW: STATE TRANSITIONS ---

/**
 * Advances the user's state and asks the next question.
 * @param {object} ctx - Telegraf context object.
 * @param {string} currentStage - The stage the user just completed (e.g., 'q1').
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

// --- UTILITY FUNCTIONS ---

/**
 * Safely wraps user-provided text in Markdown inline code blocks.
 * This prevents any special Markdown characters (like *, _, [, ], etc.) 
 * in the user's input from breaking the Telegram message formatting, 
 * which caused the "can't parse entities" error.
 * Internal backticks are replaced with single quotes for further safety.
 * @param {string} text - The raw user input.
 * @returns {string} The input wrapped in backticks (e.g., `user input`).
 */
const wrapUserInput = (text) => {
    return '`' + String(text).replace(/`/g, "'") + '`';
};

// --- ADMIN NOTIFICATION AND ORDER COMPLETION ---

async function finalizeOrder(ctx) {
    const chatId = ctx.chat.id;
    const session = userSessions[chatId];
    const newOrderId = orderIdCounter++;

    // Create the final order object
    const finalOrder = {
        id: newOrderId,
        userId: ctx.from.id,
        username: ctx.from.username || ctx.from.first_name,
        q1_order: session.q1_order,
        q2_size: session.q2_size,
        q3_color: session.q3_color,
        q4_photo_file_id: session.q4_photo_file_id || 'N/A', // Photo ID or N/A
        q5_phone: session.q5_phone,
        status: 'pending'
    };

    orders[newOrderId] = finalOrder;

    // Clear user session
    delete userSessions[chatId];

    // 1. Confirmation to buyer
    ctx.reply(`✅ *Order Request Sent!* (ID: ${newOrderId})\n
Thank you for your request. We will review your custom order details and the reference photo (if provided), and confirm it soon.

*Reminder:* Please ensure you have used the *Upload Receipt* button to confirm your advance payment.`,
    { parse_mode: 'Markdown' });

    // 2. Notify Admin with Details and Accept Button
    // CRITICAL FIX: Removing Markdown parse mode and simplifying the adminMessage
    // to prevent the "can't parse entities" error that occurs when mixing photos,
    // custom user input (even if wrapped), and Markdown formatting in the caption/fallback text.

    // Using plain text labels (removed asterisks) but keeping user input wrapped in backticks
    // for clear separation and displaying file IDs safely.
    const adminMessage = `🚨 NEW CUSTOM ORDER PENDING (ID: ${newOrderId}) 🚨
Customer: ${ctx.from.first_name} (@${ctx.from.username || 'N/A'})
User ID: ${finalOrder.userId}
---
1. Order Type: ${wrapUserInput(finalOrder.q1_order)}
2. Size/Measurements: ${wrapUserInput(finalOrder.q2_size)}
3. Color/Fabric: ${wrapUserInput(finalOrder.q3_color)}
5. Phone Number: ${wrapUserInput(finalOrder.q5_phone)}
Photo ID: ${wrapUserInput(finalOrder.q4_photo_file_id)}`; 

    const acceptanceKeyboard = {
        // Explicitly removed parse_mode: 'Markdown' here to force plain text for stability
        reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('✅ Accept & Process Order', `accept_order_${newOrderId}`)],
            [Markup.button.callback('❌ Reject Order (Not Implemented)', 'reject_order')]
        ])
    };

    const hasPhoto = finalOrder.q4_photo_file_id !== 'N/A' && finalOrder.q4_photo_file_id !== 'Skipped by user (text)';

    // Iterate through all admins to send the notification
    for (const adminId of ADMIN_IDS) {
        if (hasPhoto) {
            // Send the photo with the full order details and buttons as the caption
            try {
                await ctx.telegram.sendPhoto(adminId, finalOrder.q4_photo_file_id, {
                    caption: adminMessage, // Full details sent as the caption
                    ...acceptanceKeyboard // Include the buttons (without parse_mode)
                });
            } catch (error) {
                console.error(`Failed to send order photo with details to admin ${adminId}. Falling back to text message:`, error);
                
                // Fallback: Send only the text message if photo sending failed
                // The adminMessage now has plain text structure. We add a warning.
                const fallbackWarning = `⚠️ Failed to display photo for Order ${newOrderId}. Photo File ID: ${finalOrder.q4_photo_file_id}\n\n`;

                // We must ensure the fallback sendMessage also does NOT use Markdown.
                await ctx.telegram.sendMessage(adminId, fallbackWarning + adminMessage, acceptanceKeyboard);
            }
        } else {
            // Send the detailed message (text only) - again, without parse_mode
            ctx.telegram.sendMessage(adminId, adminMessage, acceptanceKeyboard)
                .catch(err => console.error(`Failed to send admin notification to ${adminId}:`, err));
        }
    }
}

// Function to handle receipt finalization
async function finalizeReceipt(ctx, session, fileId) {
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name;
    const phone = session.receipt_phone;

    // Iterate through all admins to send the receipt notification
    for (const adminId of ADMIN_IDS) {
        // Send the photo first. We removed parse_mode to prevent parsing errors
        await ctx.telegram.sendPhoto(adminId, fileId, {
            // Caption is now simple plain text to avoid parsing issues with user input or special characters.
            caption: `💰 NEW PAYMENT RECEIPT RECEIVED 💰
Customer: ${username} (ID: ${userId})
Phone Number (for verification): ${phone}
---
ACTION REQUIRED: Please check bank account (1000495773268) to verify the 200 birr advance payment.`,
            // REMOVED parse_mode: 'Markdown' to prevent the 400 Bad Request error
        }).catch(error => {
            // This is the initial error, logged to console.
            console.error(`[RECEIPT ERROR] Failed to send receipt photo to admin ID ${adminId}. Reason:`, error.message || error);
            
            // Fallback message: Do NOT use parse_mode here to prevent crashes from unescaped characters in the error message.
            const fallbackText = `⚠️ FAILED to display payment receipt photo for user ${username} (ID: ${userId}). 
Phone: ${phone}. 
File ID: ${fileId}. 
(Original Send Error: ${error.message || 'Check bot console'})
---
ACTION REQUIRED: Please verify the payment manually.`;

            ctx.telegram.sendMessage(adminId, fallbackText) // No parse_mode here!
                .catch(e => console.error("CRITICAL: Failed to send fallback message to admin:", e));
        });
    }
    
    // Notify user
    ctx.reply('✅ Receipt uploaded successfully! Thank you for confirming your advance payment. We will now cross-reference this with your custom order details.');
    
    // Clear receipt session
    delete userSessions[ctx.chat.id];
}


// --- TELEGRAF HANDLERS ---

// 1. Global Error Handler (Prevents bot crash)
bot.catch((err, ctx) => {
    console.error(`[Global Bot Error] for ${ctx.updateType}:`, err.message || err);
    
    // Send a user-friendly message back to the user's chat
    if (ctx.chat && ctx.chat.id) {
        ctx.reply('⚠️ Oops! I ran into an unexpected error while processing your request. Please try again or use the main menu buttons.', {
            parse_mode: 'Markdown'
        }).catch(replyErr => console.error("Failed to send error message back to user:", replyErr));
    }
});


// 2. Start command/Main Menu
bot.start((ctx) => {
    ctx.reply(WELCOME_MESSAGE,
    {
        parse_mode: 'Markdown',
        ...Markup.keyboard([
            ['📦 Place New Custom Order', '🖼️ Upload Receipt'], // Added Upload Receipt button
        ]).resize()
    });
});

// 3. Handle the "Place New Custom Order" button
bot.hears('📦 Place New Custom Order', (ctx) => {
    // Start the first question
    userSessions[ctx.chat.id] = { stage: 'awaiting_q1' };
    ctx.reply('Let’s begin your order request! Please answer the following questions 👇\n\n' + QUESTIONS.q1,
    { parse_mode: 'Markdown' });
});

// 4. Handle the "Upload Receipt" button
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
        // Check if the current user is one of the authorized ADMIN_IDS
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

        // Notify customer
        try {
            await ctx.telegram.sendMessage(order.userId,
                `🎉 *Good News!* Your custom order (#${orderId}) has been **ACCEPTED** by the NAYA wear team and is being processed! We will contact you at ${order.q5_phone} soon.`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error(`Could not notify user ${order.userId}:`, error);
        }

        // Edit the admin's message to reflect acceptance
        await ctx.editMessageText(`✅ **ORDER ACCEPTED** (ID: ${orderId})
This custom order has been processed.`, { parse_mode: 'Markdown' });

        delete orders[orderId];
        ctx.answerCbQuery('Order accepted successfully!', true);
        return;
    }

    // User skipping the optional photo step (Q4)
    if (data === 'skip_photo' && session && session.stage === 'awaiting_photo') {
        session.q4_photo_file_id = 'Skipped by user (text)';
        // Remove the inline keyboard from the message
        await ctx.editMessageReplyMarkup({});
        ctx.answerCbQuery('Photo step skipped.');
        // Transition to Q5
        await transitionState(ctx, 'photo_received');
        return;
    }

    // Ignore other callback queries
    ctx.answerCbQuery();
});


// 6. Handle Photo Input (Specifically for Q4 or Receipt)
bot.on('photo', async (ctx) => {
    const chatId = ctx.chat.id;
    const session = userSessions[chatId];

    if (!session) {
        return ctx.reply("I don't have an active order or receipt session for you. Please use the menu buttons to start.");
    }
    
    // Get the file_id of the largest photo size
    const photoArray = ctx.message.photo;
    const largestPhoto = photoArray[photoArray.length - 1];
    const fileId = largestPhoto.file_id;

    // Handle Receipt Upload Flow
    if (session.stage === 'awaiting_receipt_photo') {
        // Finalize Receipt will attempt to send the photo to admin
        await finalizeReceipt(ctx, session, fileId); 
        return;
    }

    // Handle Q4 Reference Photo Flow
    if (session.stage === 'awaiting_photo') {
        session.q4_photo_file_id = fileId;
        ctx.reply('📸 Reference photo received! Thank you.');
        // Transition to Q5
        transitionState(ctx, 'photo_received');
        return;
    }

    // Fallback if photo is sent outside of an expected stage
    ctx.reply("Got your image! Please continue answering the questions based on the last prompt.");
});


// 7. Handle Text Input (Q1, Q2, Q3, Q5, and Receipt Phone)
bot.on('text', (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;
    const session = userSessions[chatId];

    // Ignore menu button presses
    if (text === '📦 Place New Custom Order' || text === '🖼️ Upload Receipt') {
        return;
    }

    // Must be in an active session
    if (!session) {
        return ctx.reply("I don't have an active session for you. Please use the '📦 Place New Custom Order' or '🖼️ Upload Receipt' button to start.");
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


// Launch the bot
bot.launch().then(() => {
    console.log('NAYA wear ShopBot is running...');
    
    // Set command menu
    bot.telegram.setMyCommands([
        { command: 'start', description: 'Show the welcome message and main menu' },
    ]).catch(err => console.error("Failed to set commands:", err));
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
