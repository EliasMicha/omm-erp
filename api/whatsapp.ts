import { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL = 'https://ubbumxommqjcpdozpunf.supabase.co';
const SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InViYnVteG9tbXFqY3Bkb3pwdW5mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MTcwMDAwMDAwMH0.';

interface TwilioPayload {
  MessageSid: string;
  AccountSid: string;
  MessagingServiceSid?: string;
  From: string;
  To: string;
  Body: string;
  NumMedia: string;
  [key: string]: string | undefined;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ConversationRecord {
  id: string;
  phone_number: string;
  created_at: string;
  updated_at: string;
}

interface MessageRecord {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

const getOrCreateConversation = async (
  phoneNumber: string
): Promise<string> => {
  try {
    // Try to get existing conversation
    const getResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_conversations?phone_number=eq.${encodeURIComponent(phoneNumber)}&select=id`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          apikey: SUPABASE_KEY,
        },
      }
    );

    if (getResponse.ok) {
      const data = await getResponse.json();
      if (data && data.length > 0) {
        return data[0].id;
      }
    }

    // Create new conversation
    const createResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_conversations`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          apikey: SUPABASE_KEY,
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          phone_number: phoneNumber,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      }
    );

    if (!createResponse.ok) {
      throw new Error('Failed to create conversation');
    }

    const created = await createResponse.json();
    return created[0].id;
  } catch (error) {
    console.error('Error managing conversation:', error);
    throw error;
  }
};

const saveMessage = async (
  conversationId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<void> => {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/agent_messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
      },
      body: JSON.stringify({
        conversation_id: conversationId,
        role,
        content,
        created_at: new Date().toISOString(),
      }),
    });
  } catch (error) {
    console.error('Error saving message:', error);
  }
};

const getConversationHistory = async (
  conversationId: string,
  limit: number = 20
): Promise<Message[]> => {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_messages?conversation_id=eq.${conversationId}&order=created_at.desc&limit=${limit}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          apikey: SUPABASE_KEY,
        },
      }
    );

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    return data
      .reverse()
      .map((msg: MessageRecord) => ({
        role: msg.role,
        content: msg.content,
      }));
  } catch (error) {
    console.error('Error fetching history:', error);
    return [];
  }
};

const getChatbotResponse = async (
  message: string,
  history: Message[],
  host: string
): Promise<string> => {
  try {
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const response = await fetch(`${protocol}://${host}/api/chatbot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        history,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to get chatbot response');
    }

    const data = await response.json();
    return data.reply || 'Lo siento, no pude procesar tu mensaje.';
  } catch (error) {
    console.error('Error getting chatbot response:', error);
    return 'Disculpa, ocurrió un error. Por favor intenta nuevamente.';
  }
};

const sendTwilioMessage = async (
  senderPhone: string,
  replyText: string
): Promise<void> => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioNumber = process.env.TWILIO_WHATSAPP_NUMBER;

  if (!accountSid || !authToken || !twilioNumber) {
    throw new Error('Missing Twilio credentials');
  }

  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  const response = await fetch(twilioUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      From: `whatsapp:${twilioNumber}`,
      To: `whatsapp:${senderPhone}`,
      Body: replyText,
    }).toString(),
  });

  if (!response.ok) {
    throw new Error(`Twilio API error: ${response.statusText}`);
  }
};

export default async (req: VercelRequest, res: VercelResponse) => {
  // GET endpoint for webhook verification
  if (req.method === 'GET') {
    const hubChallenge = req.query['hub.challenge'];
    const hubVerifyToken = req.query['hub.verify_token'];

    // Optional: Verify the token if you have one
    if (hubChallenge) {
      res.status(200).send(hubChallenge);
      return;
    }

    res.status(400).send('Invalid request');
    return;
  }

  // POST endpoint for incoming messages
  if (req.method === 'POST') {
    try {
      const payload = req.body as TwilioPayload;

      // Extract sender phone number (remove 'whatsapp:' prefix if present)
      let senderPhone = payload.From || '';
      if (senderPhone.startsWith('whatsapp:')) {
        senderPhone = senderPhone.slice(9);
      }

      const messageText = payload.Body || '';

      if (!senderPhone || !messageText) {
        res.status(400).send('Invalid payload');
        return;
      }

      // Get or create conversation
      const conversationId = await getOrCreateConversation(senderPhone);

      // Save user message
      await saveMessage(conversationId, 'user', messageText);

      // Get conversation history
      const history = await getConversationHistory(conversationId);

      // Get chatbot response
      const reply = await getChatbotResponse(messageText, history, req.headers.host || '');

      // Save bot response
      await saveMessage(conversationId, 'assistant', reply);

      // Send response via Twilio WhatsApp
      await sendTwilioMessage(senderPhone, reply);

      res.status(200).json({ success: true });
    } catch (error) {
      console.error('Error processing message:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  } else {
    res.status(405).send('Method not allowed');
  }
};
