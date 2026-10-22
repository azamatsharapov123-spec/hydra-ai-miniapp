import { authUser, sendError } from '../lib/auth.js';
import { getHistory, supportState, handleSupportMessage } from '../lib/support.js';

// ИИ может думать несколько секунд
export const config = { maxDuration: 30 };

// GET — переписка и остаток сообщений. POST {text} — сообщение в поддержку: отвечает ИИ, сложное уходит администратору.
export default async function handler(req, res) {
  try {
    const { user } = await authUser(req);
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET') {
      const st = await supportState(user);
      return res.status(200).json({ messages: await getHistory(user.id), ...st });
    }
    if (req.method === 'POST') {
      const out = await handleSupportMessage(user, (req.body || {}).text);
      const st = await supportState(user);
      return res.status(200).json({ success: true, replies: out.replies, limited: !!out.limited, escalated: !!out.escalated, ...st });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return sendError(res, e);
  }
}
