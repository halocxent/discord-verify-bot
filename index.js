require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, InteractionType } = require('discord.js');
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');

//config -
const requiredEnv = ['DISCORD_TOKEN', 'VERIFIED_ROLE_ID', 'HCAPTCHA_SITE_KEY', 'HCAPTCHA_SECRET_KEY', 'EMBED_CHANNEL_ID', 'LOGS_CHANNEL_ID'];
const missingEnv = requiredEnv.filter(key => !process.env[key]);
if (missingEnv.length > 0) {
    console.error(`err: missing env: ${missingEnv.join(', ')}`);
    process.exit(1);
}

// global state
const pendingver = new Map();
const IP_FILE = 'ip.json';
let ipMap = {};

// load db
if (fs.existsSync(IP_FILE)) {
    try {
        ipMap = JSON.parse(fs.readFileSync(IP_FILE, 'utf8'));
        console.log(`Loaded ${Object.keys(ipMap).length} IP records.`);
    } catch (e) {
        console.error("err reading ip.json:", e);
    }
} else {
    console.log("no ip.json found creating new one...");
    saveip();
}

function saveip() {
    try {
        fs.writeFileSync(IP_FILE, JSON.stringify(ipMap, null, 2));
    } catch (e) {
        console.error("Error saving ip.json:", e);
    }
}

const app = express();
app.use(express.urlencoded({ extended: true }));

// content
const getHtml = (data) => `
<!DOCTYPE html>
<html>
<head>
    <title>Verification</title>
    <script src="https://js.hcaptcha.com/1/api.js" async defer></script>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #2b2d31; color: #dbdee1; margin: 0; }
        .container { background-color: #313338; padding: 40px; border-radius: 8px; text-align: center; box-shadow: 0 4px 15px rgba(0,0,0,0.4); max-width: 400px; width: 100%; }
        h2 { color: #f2f3f5; margin-top: 0; }
        button { background-color: #5865F2; color: white; padding: 12px 20px; border: none; border-radius: 4px; cursor: pointer; margin-top: 20px; width: 100%; font-weight: 600; font-size: 16px; transition: background-color 0.2s; }
        button:hover { background-color: #4752c4; }
        .error { color: #fa777c; background: rgba(250, 119, 124, 0.1); padding: 10px; border-radius: 4px; margin-bottom: 15px; text-align: left; font-size: 14px; }
        .success { color: #57F287; margin-bottom: 10px; font-size: 18px; font-weight: bold; }
        .info { color: #949ba4; font-size: 13px; margin-top: 20px; }
        .h-captcha { display: flex; justify-content: center; margin-top: 15px; }
    </style>
</head>
<body>
    <div class="container">
        <h2>Security Check</h2>
        ${data.error ? `<div class="error">${data.error}</div>` : ''}

        ${data.success ? `
             <div class="success">Verification Successful</div>
             <p>You have been assigned the role. You can close this tab.</p>
        ` : `
            <p>Please complete the captcha to verify you are human.</p>
            <form method="POST">
                <div class="h-captcha" data-sitekey="${process.env.HCAPTCHA_SITE_KEY}"></div>
                <button type="submit">Verify</button>
            </form>
            <div class="info">
                Powered by hCaptcha -Made by halocxent(on github)
            </div>
        `}
    </div>
</body>
</html>
`;

// checker
async function isProxy(ip) {
    if (!process.env.PROXYCHECK_KEY) return false;
    try {
        const url = `http://proxycheck.io/v2/${ip}?key=${process.env.PROXYCHECK_KEY}&vpn=1&asn=1`;
        const response = await axios.get(url, { timeout: 5000 });
        const data = response.data;
        if (data.status === 'ok' && data[ip]) return data[ip].proxy === 'yes';
    } catch (error) {
        console.error("Proxy check failed:", error.message);
    }
    return false;
}

// verify captcha
async function verfcc(token) {
    if (!token) return false;
    try {
        const params = new URLSearchParams();
        params.append('secret', process.env.HCAPTCHA_SECRET_KEY);
        params.append('response', token);
        const response = await axios.post('https://api.hcaptcha.com/siteverify', params);
        return response.data.success;
    } catch (error) {
        console.error("hCaptcha verification failed:", error.message);
        return false;
    }
}

// logger
async function logToDiscord(title, description, color, fields = []) {
    try {
        const channel = await client.channels.fetch(process.env.LOGS_CHANNEL_ID);
        if (channel) {
            const embed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(description)
                .setColor(color)
                .setTimestamp()
                .addFields(fields);
            await channel.send({ embeds: [embed] });
        }
    } catch (error) {
        console.error("Failed to log to Discord:", error.message);
    }
}

// get /verify/:token
app.get('/verify/:token', (req, res) => {
    const { token } = req.params;
    if (!pendingver.get(token)) return res.status(404).send("Invalid or expired link.");
    res.send(getHtml({}));
});

// post /verify/:token
app.post('/verify/:token', async (req, res) => {
    const { token } = req.params;
    const hCaptchaResponse = req.body['h-captcha-response'];
    const session = pendingver.get(token);

    if (!session) return res.status(404).send("Invalid link.");

    // captcha 
    const isCaptchaValid = await verfcc(hCaptchaResponse);
    if (!isCaptchaValid) return res.send(getHtml({ error: "Captcha failed. Please try again." }));

    // get ip
    const userIp = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;

    // alt acc check
    if (ipMap[userIp] && ipMap[userIp] !== session.userId) {
        const prevUserId = ipMap[userIp];

        await logToDiscord(
            "Alt Account Blocked",
            `**User:** <@${session.userId}>\n**Reason:** IP matched existing user <@${prevUserId}>.`,
            0xFF0000, // Red
            [{ name: "IP Address", value: `||${userIp}||`, inline: true }]
        );

        return res.send(getHtml({ error: "Verification Failed: This IP address is already linked to another account." }));
    }

    // check proxy and vpn
    const proxyDetected = await isProxy(userIp);
    if (proxyDetected) {
        await logToDiscord(
            "VPN/Proxy Blocked",
            `**User:** <@${session.userId}>\n**Reason:** VPN or Proxy detected.`,
            0xFFA500, // Orange
            [{ name: "IP Address", value: `||${userIp}||`, inline: true }]
        );
        return res.send(getHtml({ error: "VPN/Proxy Detected. Please disable it and try again." }));
    }

    // success
    try {
        const guild = await client.guilds.fetch(session.guildId);
        const member = await guild.members.fetch(session.userId);

        await member.roles.add(process.env.VERIFIED_ROLE_ID);

        // save ip
        ipMap[userIp] = session.userId;
        saveip();

        // logs
        await logToDiscord(
            "Verification Successful",
            `**User:** <@${session.userId}>\n**Status:** Role Assigned.`,
            0x57F287, // Green
            [{ name: "IP Address", value: `||${userIp}||`, inline: true }]
        );

        try { await member.send("You have been successfully verified!"); } catch (e) {}

        pendingver.delete(token);
        res.send(getHtml({ success: true }));

    } catch (error) {
        console.error("Assign role error:", error);
        res.send(getHtml({ error: "System Error: Could not assign role." }));
    }
});

app.listen(process.env.PORT || 3000, () => console.log(`Server running on port ${process.env.PORT || 3000}`));

//dc bot
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel]
});

// auto deploy panel
client.once('ready', async () => {
    console.log(`Bot online as ${client.user.tag}`);

    // fetch embed channel
    try {
        const channel = await client.channels.fetch(process.env.EMBED_CHANNEL_ID);
        if (!channel) {
            console.error("EMBED_CHANNEL_ID not found or bot lacks access.");
            return;
        }

        // check if panel already exist
        const messages = await channel.messages.fetch({ limit: 5 });
        const alreadySent = messages.some(m => m.author.id === client.user.id && m.components.length > 0);

        if (!alreadySent) {
            const embed = new EmbedBuilder()
                .setTitle('Server Verification')
                .setDescription('Please click the button below to verify your account and gain access to the server.')
                .setColor(0x5865F2);

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('verify_btn')
                        .setLabel('Verify Now')
                        .setStyle(ButtonStyle.Primary)
                        // Emoji removed here
                );

            await channel.send({ embeds: [embed], components: [row] });
            console.log("Verification panel auto-deployed.");
        } else {
            console.log("Verification panel already exists. Skipping deployment.");
        }

    } catch (error) {
        console.error("Error auto-sending verification panel:", error);
    }
});

// handle button
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    if (interaction.customId === 'verify_btn') {

        // check verify status
        if (interaction.member.roles.cache.has(process.env.VERIFIED_ROLE_ID)) {
            return interaction.reply({ content: "You are already verified!", ephemeral: true });
        }

        // base64, 30 char
        const token = crypto.randomBytes(24).toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '')
            .substring(0, 30);

        pendingver.set(token, { userId: interaction.user.id, guildId: interaction.guild.id });

        const verifyLink = `${process.env.DOMAIN}/verify/${token}`;

        try {
            const dmEmbed = new EmbedBuilder()
                .setTitle('Verification Link')
                .setDescription(`Click the link below to verify:\n\n**[Verify Here](${verifyLink})**\n\n*This link expires in 5 minutes.*`)
                .setColor(0x5865F2);

            await interaction.user.send({ embeds: [dmEmbed] });
            await interaction.reply({ content: "I have sent you a verification link via DM.", ephemeral: true });

            // cleanup 5mins
            setTimeout(() => pendingver.delete(token), 5 * 60 * 1000);

        } catch (e) {
            interaction.reply({ content: "I couldn't DM you. Please enable your DMs for this server and try again.", ephemeral: true });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
