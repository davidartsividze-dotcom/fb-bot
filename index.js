require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error('❌ ANTHROPIC_API_KEY არ არის დაყენებული!');
}
const SHOP_NAME = process.env.SHOP_NAME || 'ჩვენი მაღაზია';

// მომხმარებლების საუბრის ისტორია (მეხსიერება)
const conversations = {};

// ════════════════════════════════════════
// Webhook Verification — Facebook ამოწმებს სერვერს
// ════════════════════════════════════════
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook დადასტურდა!');
    res.status(200).send(challenge);
  } else {
    console.log('❌ Webhook-ის დადასტურება ვერ მოხერხდა');
    res.sendStatus(403);
  }
});

// ════════════════════════════════════════
// შემომავალი შეტყობინებები Facebook-იდან
// ════════════════════════════════════════
app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object !== 'page') {
    return res.sendStatus(404);
  }

  for (const entry of body.entry) {
    for (const event of entry.messaging) {
      if (event.message?.text) {
        const senderId = event.sender.id;
        const messageText = event.message.text;
        console.log(`📩 შეტყობინება: ${messageText} (from: ${senderId})`);
        await handleMessage(senderId, messageText);
      }
    }
  }

  res.status(200).send('EVENT_RECEIVED');
});

// ════════════════════════════════════════
// მთავარი Handler — შეტყობინების დამუშავება
// ════════════════════════════════════════
async function handleMessage(senderId, messageText) {
  try {
    // "ვწერ..." ინდიკატორი
    await setTypingIndicator(senderId, true);

    // Claude-ისგან პასუხის მიღება
    const reply = await generateReply(senderId, messageText);

    // ტაიპინგის გამორთვა
    await setTypingIndicator(senderId, false);

    // პასუხის გაგზავნა
    await sendMessage(senderId, reply);

    console.log(`✅ პასუხი გაიგზავნა: ${reply.substring(0, 50)}...`);
  } catch (err) {
    console.error('❌ შეცდომა:', err.message);
    await sendMessage(senderId, 'ბოდიში, დროებით ტექნიკური პრობლემაა. გთხოვთ ცოტა ხანში სცადოთ.');
  }
}

// ════════════════════════════════════════
// Claude API — ჭკვიანი პასუხის გენერაცია
// ════════════════════════════════════════
async function generateReply(senderId, userMessage) {
  // საუბრის ისტორია (კონტექსტი)
  if (!conversations[senderId]) {
    conversations[senderId] = [];
  }

  // მომხმარებლის შეტყობინების დამატება ისტორიაში
  conversations[senderId].push({
    role: 'user',
    content: userMessage
  });

  // ისტორია მაქსიმუმ 20 შეტყობინებამდე (მეხსიერების დაზოგვა)
  if (conversations[senderId].length > 20) {
    conversations[senderId] = conversations[senderId].slice(-20);
  }

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: `შენ ხარ "${SHOP_NAME}"-ის Facebook მესენჯერის ასისტენტი.

🎯 შენი მთავარი ამოცანები:
- მომხმარებლის ნებისმიერ კითხვაზე გასცე სასარგებლო პასუხი
- პროდუქტების, ფასების, მიტანის შესახებ ინფო მიაწოდე
- შეძენის სურვილის შემთხვევაში შეაგროვე: სახელი, მისამართი, ტელეფონი
- ყოველთვის მეგობრული და პროფესიონალური იყავი

📦 შეკვეთის მიღებისას გამოიყენე ეს ფორმატი:
"✅ შეკვეთა მიღებულია!
📦 პროდუქტი: [სახელი]
📍 მისამართი: [მისამართი]
📞 ტელეფონი: [ნომერი]
🕐 მიტანა: 2-3 სამუშაო დღეში
გმადლობთ!"

⚠️ მნიშვნელოვანი:
- პასუხები მოკლე და გასაგები
- ქართულად წერე ყოველთვის
- თუ კითხვა შენს კომპეტენციას სცილდება, თქვი "ამ კითხვაზე ადმინისტრატორი დაგიკავშირდებათ"`,
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

  const assistantReply = response.data.content[0].text;

  // ასისტენტის პასუხის ისტორიაში დამატება
  conversations[senderId].push({
    role: 'assistant',
    content: assistantReply
  });

  return assistantReply;
}

// ════════════════════════════════════════
// Facebook-ზე შეტყობინების გაგზავნა
// ════════════════════════════════════════
async function sendMessage(recipientId, text) {
  await axios.post(
    'https://graph.facebook.com/v19.0/me/messages',
    {
      recipient: { id: recipientId },
      message: { text }
    },
    {
      params: { access_token: PAGE_ACCESS_TOKEN }
    }
  );
}

// ════════════════════════════════════════
// "ვწერ..." ინდიკატორი
// ════════════════════════════════════════
async function setTypingIndicator(recipientId, isTyping) {
  await axios.post(
    'https://graph.facebook.com/v19.0/me/messages',
    {
      recipient: { id: recipientId },
      sender_action: isTyping ? 'typing_on' : 'typing_off'
    },
    {
      params: { access_token: PAGE_ACCESS_TOKEN }
    }
  );
}

// ════════════════════════════════════════
// სერვერის გაშვება
// ════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 ბოტი გაშვებულია პორტი ${PORT}-ზე`);
  console.log(`📡 Webhook URL: https://შენი-სერვერი/webhook`);
});
