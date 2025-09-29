import { Client, GatewayIntentBits } from "discord.js";
import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } from "@discordjs/voice";
import fetch from "node-fetch";
import fs from "fs";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});

let ready = false;
client.once("ready", () => {
  console.log("Bot logged in!");
  ready = true;
});
client.login(process.env.BOT_TOKEN);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  const { text, guildId, channelId, username, personality } = req.body;

  if (!text || !guildId || !channelId || !username) {
    return res.status(400).json({ error: "text, guildId, channelId, username required" });
  }

  if (!ready) return res.status(500).json({ error: "Bot not ready yet" });

  try {
    // 1️⃣ Groq sohbet API'ye mesaj gönder
    const chatRes = await fetch("https://grokenforceplus.vercel.app/api/enforce-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_name: username,
        message: text,
        personality: personality || "friendly"
      })
    });

    const chatData = await chatRes.json();
    if (!chatData.reply) return res.status(500).json({ error: "Groq chat API failed" });

    const replyText = chatData.reply;

    // 2️⃣ Groq TTS API ile ses üret
    const ttsRes = await fetch("https://api.groq.com/openai/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "playai-tts",
        voice: "Arista-PlayAI",
        input: replyText,
        response_format: "wav"
      })
    });

    const buffer = Buffer.from(await ttsRes.arrayBuffer());
    const filePath = "/tmp/tts.wav";
    fs.writeFileSync(filePath, buffer);

    // 3️⃣ Bot ses kanalına bağlan ve sesi çal
    const guildObj = client.guilds.cache.get(guildId);
    if (!guildObj) return res.status(404).json({ error: "Guild not found" });

    const connection = joinVoiceChannel({
      channelId: channelId,
      guildId: guildId,
      adapterCreator: guildObj.voiceAdapterCreator
    });

    const player = createAudioPlayer();
    const resource = createAudioResource(filePath);
    player.play(resource);
    connection.subscribe(player);

    player.on(AudioPlayerStatus.Idle, () => connection.destroy());

    return res.json({ success: true, reply: replyText });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Something went wrong", details: e.message });
  }
}
