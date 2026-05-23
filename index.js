require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SHOP_NAME = process.env.SHOP_NAME || 'ჩვენი მაღაზია';

const conversations = {};

// Webhook Verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// შემომავალი შეტყობინებები
app.post('/webhook', (req, res) => {
  // პირველად 200 ვაბრუნებთ
  res.status(200).send('EVENT_RECEIVED');

  const body = req.body;
  if (body.object !== 'page') return;

  for (const entry of body.entry) {
    const messaging = entry.messaging || [];
    for (const event of messaging) {
      // მხოლოდ ადამიანის შეტყობინება, echo არა
      if (event.message && event.message.text && !event.message.is_echo) {
        handleMessage(event.sender.id, event.message.text);
      }
    }
  }
});

async function handleMessage(senderId, text) {
  try {
    const reply = await generateReply(senderId, text);
    await sendMessage(senderId, reply);
  } catch (err) {
    console.error('შეცდომა:', err.message);
    await sendMessage(senderId, 'ბოდიში, დროებით ტექნიკური პრობლემაა.');
  }
}

async function generateReply(senderId, userMessage) {
  if (!conversations[senderId]) conversations[senderId] = [];

  conversations[senderId].push({ role: 'user', content: userMessage });

  if (conversations[senderId].length > 20) {
    conversations[senderId] = conversations[senderId].slice(-20);
  }

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: `შენ ხარ "${SHOP_NAME}"-ის Facebook მესენჯერის ასისტენტი. მეგობრულად უპასუხე ნებისმიერ კითხვას ქართულად. შეძენის სურვილის შემთხვევაში სთხოვე: სახელი, მისამართი, ტელეფონი.`,
      messages: conversations[senderId]
    },
    {
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      }
    }
  );

  const reply = response.data.content[0].text;
  conversations[senderId].push({ role: 'assistant', content: reply });
  return reply;
}

async function sendMessage(recipientId, text) {
  await axios.post(
    'https://graph.facebook.com/v19.0/me/messages',
    { recipient: { id: recipientId }, message: { text } },
    { params: { access_token: PAGE_ACCESS_TOKEN } }
  );
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ბოტი გაშვებულია პორტი ${PORT}-ზე`));
