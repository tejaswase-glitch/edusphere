// EduSphere Edge Function: jaas-token
// Issues short-lived, room-scoped JaaS JWTs only to approved EduSphere users.
// Required Supabase secrets: JAAS_APP_ID, JAAS_API_KEY_ID, JAAS_PRIVATE_KEY.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { importPKCS8, SignJWT } from 'npm:jose@5.9.6';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    const url = Deno.env.get('SUPABASE_URL');
    const anon = Deno.env.get('SUPABASE_ANON_KEY');
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const appId = Deno.env.get('JAAS_APP_ID');
    const apiKeyId = Deno.env.get('JAAS_API_KEY_ID');
    const privateKeyText = Deno.env.get('JAAS_PRIVATE_KEY');
    if (!url || !anon || !service || !appId || !apiKeyId || !privateKeyText) {
      return json({ error: 'JaaS server configuration is incomplete. Check Supabase function secrets.' }, 500);
    }
    if (!apiKeyId.startsWith(appId + '/')) {
      return json({ error: 'JAAS_API_KEY_ID must contain the full AppID/key-id value.' }, 500);
    }

    const authHeader = req.headers.get('Authorization') || '';
    const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!bearer) return json({ error: 'Please sign in to EduSphere again.' }, 401);

    const authClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await authClient.auth.getUser(bearer);
    if (authError || !authData.user) return json({ error: 'Your EduSphere session is invalid. Please sign in again.' }, 401);

    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile, error: profileError } = await admin
      .from('profiles').select('id,full_name,email,role,status')
      .eq('id', authData.user.id).maybeSingle();
    if (profileError) return json({ error: 'Could not verify your EduSphere account.' }, 500);
    if (!profile || profile.status !== 'approved' || !['admin', 'teacher', 'student'].includes(profile.role)) {
      return json({ error: 'Only approved EduSphere accounts can join live classes.' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const classId = String(body?.classId || '');
    if (!/^[0-9a-f-]{30,40}$/i.test(classId)) return json({ error: 'A valid class is required.' }, 400);

    const { data: liveClass, error: classError } = await admin
      .from('live_classes')
      .select('id,title,provider,meeting_room,meeting_url,created_by,is_published,status')
      .eq('id', classId).maybeSingle();
    if (classError) return json({ error: 'Could not load this live class.' }, 500);
    if (!liveClass || liveClass.provider !== 'jitsi' || liveClass.status !== 'scheduled') {
      return json({ error: 'This JaaS class is unavailable or has ended.' }, 404);
    }

    const isModerator = profile.role === 'admin' ||
      (profile.role === 'teacher' && liveClass.created_by === profile.id);
    if (profile.role === 'teacher' && !isModerator) {
      return json({ error: 'Teachers can moderate only their own classes.' }, 403);
    }
    if (profile.role === 'student' && !liveClass.is_published) {
      return json({ error: 'This class is not published for students.' }, 403);
    }

    const room = String(liveClass.meeting_room || '').trim();
    if (!/^[A-Za-z0-9_-]{3,80}$/.test(room)) {
      return json({ error: 'This class has an invalid room name. Please reschedule it.' }, 400);
    }

    let pem = privateKeyText.trim().replace(/\\n/g, '\n');
    if (!pem.includes('-----BEGIN PRIVATE KEY-----') || !pem.includes('-----END PRIVATE KEY-----')) {
      return json({ error: 'The saved JaaS private key must be a PKCS#8 PEM key beginning with BEGIN PRIVATE KEY. Check the JAAS_PRIVATE_KEY secret.' }, 500);
    }
    const key = await importPKCS8(pem, 'RS256');
    const now = Math.floor(Date.now() / 1000);
    const roomName = appId + '/' + room;
    const token = await new SignJWT({
      aud: 'jitsi',
      iss: 'chat',
      sub: appId,
      room,
      context: {
        user: {
          id: profile.id,
          name: profile.full_name || 'EduSphere user',
          email: profile.email || authData.user.email || '',
          moderator: isModerator ? 'true' : 'false',
        },
        features: {
          recording: false,
          livestreaming: false,
          transcription: false,
          'outbound-call': false,
        },
        room: { regex: false },
      },
    })
      .setProtectedHeader({ alg: 'RS256', kid: apiKeyId, typ: 'JWT' })
      .setIssuedAt(now)
      .setNotBefore(now - 5)
      .setExpirationTime(now + 60 * 60)
      .sign(key);

    return json({ token, appId, roomName, moderator: isModerator });
  } catch (error) {
    console.error('jaas-token error:', error);
    return json({ error: 'Could not create a JaaS meeting token. Check the private-key format and function logs.' }, 500);
  }
});
