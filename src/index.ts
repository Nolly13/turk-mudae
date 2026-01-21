import { 
    Client, 
    GatewayIntentBits, 
    Events, 
    EmbedBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    StringSelectMenuOptionBuilder, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    AttachmentBuilder, 
    Message,
    TextChannel
} from 'discord.js';
import { config } from 'dotenv';
import http from 'http';
import { existsSync } from "fs";

// Veritabanı ve fonksiyonları tek bir yerden çekiyoruz (DÜZELTİLEN KISIM BURASI)
import db, {
    initializeDatabase,
    getOrCreateUser,
    updateUserCoins,
    claimDaily,
    addCharacter,
    getRandomCharacter,
    getAllCharacters,
    getCharacterById,
    getCharacterByName,
    giveCharacterToUser,
    getUserCharacters,
    getUserCharacterById,
    getUserCharacterByName,
    removeUserCharacter,
    upgradeCharacter,
    sellCharacter,
    createAuction,
    getActiveAuctions,
    getExpiredAuctions,
    getAuctionById,
    getAuctionByCharacterName,
    placeBid,
    completeAuction,
    deleteAuction,
    createTrade,
    getPendingTrades,
    acceptTrade,
    rejectTrade,
    getTradeByCharacterName,
    addCharacterImage,
    getCharacterImages,
    getCharacterImagesByName,
    removeCharacterImage,
    getRandomCharacterImage,
    canRoll,
    incrementRollCount,
    getUserInfo,
    canClaimCharacter,
    setClaimCooldown,
    addBonusClaim,
    addBonusRoll,
    useBonusClaim,
    useBonusRoll,
    getCharactersPaginated,
    renameCharacter,
} from "./database/db.ts";

import {
    createCharacterEmbed,
    createProfileEmbed,
    createAuctionEmbed,
    createTradeEmbed,
    createHelpEmbed,
    getRankEmoji,
} from "./utils/embeds";
import { findCharacterImage, findAllCharacterImages } from "./utils/imageUtils";
import type { SpawnedCharacter } from "./types";

// Çevre değişkenlerini yükle
config();

// Web Sunucusu (Render için gerekli)
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot aktif!');
});
const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Web sunucusu ${port} portunda calisiyor.`);
});

// Bot prefix
const PREFIX = ".";

// Aktif spawn'lar (mesaj ID bazlı - birden fazla roll için)
const activeSpawns = new Map<string, SpawnedCharacter>();

// Sahiplenme emojisi
const CLAIM_EMOJI = "❤️";

// Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions,
    ],
});

// Bot hazır olduğunda
client.once(Events.ClientReady, (readyClient) => {
    console.log(`✅ ${readyClient.user.tag} olarak giriş yapıldı!`);
    console.log(`📊 ${readyClient.guilds.cache.size} sunucuda aktif`);

    // Veritabanını başlat
    initializeDatabase();

    // Açık artırma kontrolcüsü (her dakika)
    setInterval(checkAuctions, 60000);
});

// Açık artırmaları kontrol et
async function checkAuctions() {
    // Süresi dolmuş açık artırmaları al
    const expiredAuctions = getExpiredAuctions() as any[];

    for (const auction of expiredAuctions) {
        const result = completeAuction(auction.id);

        if (result.success) {
            // Kanalı al
            let channel: TextChannel | null = null;
            if (auction.channel_id) {
                try {
                    const fetchedChannel = await client.channels.fetch(auction.channel_id).catch(() => null);
                    if (fetchedChannel?.isTextBased()) {
                        channel = fetchedChannel as TextChannel;
                    }
                } catch (e) {
                    console.error("Kanal bulunamadı:", e);
                }
            }

            if (result.winnerId) {
                // Kazanan var - kanalı bilgilendir (mention ile)
                try {
                    // Kazananın discord ID'sini bul
                    const winnerDb = db.query("SELECT discord_id FROM users WHERE id = ?").get(result.winnerId) as any;
                    if (winnerDb && channel) {
                        const embed = new EmbedBuilder()
                            .setTitle("🎉 Açık Artırma Tamamlandı!")
                            .setDescription(`**${auction.name}** karakterini <@${winnerDb.discord_id}> ${auction.current_bid} SC ile kazandı!`)
                            .setColor(0x2ECC71);
                        await channel.send({
                            content: `<@${winnerDb.discord_id}> <@${auction.seller_discord_id}>`,
                            embeds: [embed]
                        }).catch(() => { });
                    }
                } catch (e) {
                    console.error("Kazanan bilgilendirilemedi:", e);
                }
            } else {
                // Kimse teklif vermedi - satıcıyı bilgilendir, karakter onda kalıyor
                try {
                    if (channel) {
                        const embed = new EmbedBuilder()
                            .setTitle("🔨 Açık Artırma Sona Erdi")
                            .setDescription(`**${auction.name}** karakterine kimse teklif vermedi. Karakter <@${auction.seller_discord_id}>'de kalmaya devam ediyor.`)
                            .setColor(0x95A5A6);
                        await channel.send({
                            content: `<@${auction.seller_discord_id}>`,
                            embeds: [embed]
                        }).catch(() => { });
                    }
                } catch (e) {
                    console.error("Satıcı bilgilendirilemedi:", e);
                }
            }
        }
    }
}

// Mesaj olayı
client.on(Events.MessageCreate, async (message: Message) => {
    // Bot mesajlarını ve prefix'siz mesajları ignore et
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    // Komutu ve argümanları ayır
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();

    if (!command) return;

    try {
        switch (command) {
            // ==================== YARDIM ====================
            case "yardim":
            case "help":
            case "komutlar":
                await message.reply({ embeds: [createHelpEmbed()] });
                break;

            // ==================== EKONOMİ ====================
            case "bakiye":
            case "bal":
            case "para": {
                const user = getOrCreateUser(message.author.id) as any;
                const characters = getUserCharacters(message.author.id) as any[];
                await message.reply({ embeds: [createProfileEmbed(user, characters)] });
                break;
            }

            case "gunluk":
            case "daily": {
                const result = claimDaily(message.author.id);
                if (result.success) {
                    await message.reply(`✅ Günlük ödülün **${result.amount} ShoreCoin** hesabına eklendi!`);
                } else {
                    await message.reply(result.message!);
                }
                break;
            }

            case "transfer":
            case "gonder": {
                const targetUser = message.mentions.users.first();
                const amount = parseInt(args[1] || "0");

                if (!targetUser) {
                    await message.reply("❌ Bir kullanıcı etiketle! Örnek: `.transfer @kullanıcı 100`");
                    break;
                }

                if (targetUser.id === message.author.id) {
                    await message.reply("❌ Kendine para gönderemezsin!");
                    break;
                }

                if (isNaN(amount) || amount <= 0) {
                    await message.reply("❌ Geçerli bir miktar gir!");
                    break;
                }

                const sender = getOrCreateUser(message.author.id) as any;
                if (sender.shorecoins < amount) {
                    await message.reply(`❌ Yeterli ShoreCoin'in yok! Bakiyen: ${sender.shorecoins} SC`);
                    break;
                }

                getOrCreateUser(targetUser.id);
                updateUserCoins(message.author.id, -amount);
                updateUserCoins(targetUser.id, amount);

                await message.reply(`✅ **${amount} ShoreCoin** ${targetUser} kullanıcısına gönderildi!`);
                break;
            }

            // ==================== KARAKTER ====================
            case "roll":
            case "r":
            case "e":  // Erkek
            case "k":  // Kadın
            case "o":  // Oyun (Game)
            case "g":  // Generic
            case "a": { // Anime
                // Roll limit kontrolü
                const rollStatus = canRoll(message.author.id);
                if (!rollStatus.canRoll) {
                    const resetTime = rollStatus.resetAt;
                    const minutesLeft = resetTime ? Math.ceil((resetTime.getTime() - Date.now()) / 60000) : 60;
                    await message.reply(`❌ Roll hakkın bitti! ${minutesLeft} dakika sonra tekrar gel!\n🎲 Kalan: 0/10`);
                    break;
                }

                // Filtre belirle
                let filter: { gender?: string; category?: string } | undefined;
                let filterText = "";

                switch (command) {
                    case "e":
                        filter = { gender: "male" };
                        filterText = " (👨 Erkek)";
                        break;
                    case "k":
                        filter = { gender: "female" };
                        filterText = " (👩 Kadın)";
                        break;
                    case "o":
                        filter = { category: "Game" };
                        filterText = " (🎮 Oyun)";
                        break;
                    case "g":
                        filter = { category: "Generic" };
                        filterText = " (📁 Generic)";
                        break;
                    case "a":
                        filter = { category: "Anime" };
                        filterText = " (🎌 Anime)";
                        break;
                }

                const character = getRandomCharacter(filter) as any;

                if (!character) {
                    await message.reply(`❌ Sahiplenilecek karakter kalmadı!${filterText ? ` (${filterText} filtresiyle)` : ""}`);
                    break;
                }

                // Bonus roll kullanılacaksa bonus'u düşür, yoksa normal sayacı artır
                let remaining: number;
                if (rollStatus.usingBonus) {
                    useBonusRoll(message.author.id);
                    remaining = 0; // Normal roll sıfır
                } else {
                    const result = incrementRollCount(message.author.id);
                    remaining = result.remaining;
                }

                // Yeni spawn oluştur
                const spawn: SpawnedCharacter = {
                    character,
                    claimed: false,
                    claimed_by: null,
                    expires_at: Date.now() + 60000,
                    messageId: null,
                };

                const { embed, attachment } = createCharacterEmbed(character, `${getRankEmoji(character.rank)} Bir karakter belirdi!${filterText}`, true);

                // Claim durumunu kontrol et
                const canClaim = canClaimCharacter(message.author.id);
                const claimStatus = canClaim.canClaim ? "✅ Sahiplenebilirsin" : "❌ Claimin yok, bir dahaki sefere!";
                embed.setFooter({ text: `⏰ 60 saniye | 🎲 Kalan: ${remaining}/10 | ${claimStatus}` });

                const replyOptions: any = { embeds: [embed], components: [] };
                if (attachment) {
                    replyOptions.files = [attachment];
                }
                const sentMessage = await message.reply(replyOptions);

                // Mesaj ID'sini kaydet ve Map'e mesaj ID ile ekle
                spawn.messageId = sentMessage.id;
                activeSpawns.set(sentMessage.id, spawn);

                // Sahiplenme butonu oluştur (mesaj ID ile)
                const claimButton = new ButtonBuilder()
                    .setCustomId(`claim_${character.id}_${sentMessage.id}`)
                    .setLabel("❤️ Sahiplen")
                    .setStyle(ButtonStyle.Primary);

                const row = new ActionRowBuilder<ButtonBuilder>().addComponents(claimButton);

                // Mesajı butonla güncelle
                await sentMessage.edit({ components: [row] });

                // 60 saniye sonra expire et
                setTimeout(async () => {
                    const current = activeSpawns.get(sentMessage.id);
                    if (current && !current.claimed && current.character.id === character.id) {
                        activeSpawns.delete(sentMessage.id);

                        try {
                            const { embed: expiredEmbed } = createCharacterEmbed(character, `⏰ Süre Doldu!`, true);
                            expiredEmbed.setFooter({ text: "Bu karakter kaçtı! Tekrar roll yapabilirsin." });
                            expiredEmbed.setColor(0x95A5A6);

                            // Butonu devre dışı bırak
                            const disabledButton = new ButtonBuilder()
                                .setCustomId(`expired_${character.id}`)
                                .setLabel("⏰ Süre Doldu")
                                .setStyle(ButtonStyle.Secondary)
                                .setDisabled(true);

                            const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(disabledButton);

                            await sentMessage.edit({ embeds: [expiredEmbed], components: [disabledRow] });
                        } catch (e) {
                            // Mesaj silinmişse ignore
                        }
                    }
                }, 60000);
                break;
            }

            case "claim":
            case "c": {
                const spawn = activeSpawns.get(message.channelId);

                if (!spawn) {
                    await message.reply("❌ Şu anda sahiplenilecek bir karakter yok! Önce `.roll` kullan.");
                    break;
                }

                if (spawn.claimed) {
                    await message.reply(`❌ Bu karakter zaten <@${spawn.claimed_by}> tarafından sahiplenildi!`);
                    break;
                }

                if (Date.now() > spawn.expires_at) {
                    activeSpawns.delete(message.channelId);
                    await message.reply("❌ Süre doldu! Karakter kaçtı.");
                    break;
                }

                // Karakteri sahiplen
                spawn.claimed = true;
                spawn.claimed_by = message.author.id;

                const user = getOrCreateUser(message.author.id) as any;
                giveCharacterToUser(user.id, spawn.character.id);

                const { embed, attachment } = createCharacterEmbed(spawn.character);
                embed.setTitle(`✅ ${message.author.username} sahiplendi!`);
                embed.setDescription(`**${spawn.character.name}** artık senin!\nSeri: ${spawn.character.series}\nSıralama: #${spawn.character.rank}`);

                const claimOptions: any = { embeds: [embed] };
                if (attachment) claimOptions.files = [attachment];
                await message.reply(claimOptions);
                break;
            }

            case "ben":
            case "me": {
                const info = getUserInfo(message.author.id);

                // Zaman formatı
                const formatTime = (date: Date | null): string => {
                    if (!date) return "✅ Hazır!";
                    const now = Date.now();
                    const diff = date.getTime() - now;
                    if (diff <= 0) return "✅ Hazır!";

                    const minutes = Math.ceil(diff / 60000);
                    if (minutes < 60) return `⏳ ${minutes} dakika`;
                    const hours = Math.floor(minutes / 60);
                    const mins = minutes % 60;
                    return `⏳ ${hours}s ${mins}dk`;
                };

                const embed = new EmbedBuilder()
                    .setTitle(`📋 ${message.author.username}`)
                    .setColor(0x9B59B6)
                    .setThumbnail(message.author.displayAvatarURL())
                    .addFields(
                        { name: "🎲 Roll Hakkı", value: `${info.rollRemaining}/10`, inline: true },
                        { name: "⏰ Roll Reset", value: formatTime(info.rollResetTime), inline: true },
                        { name: "❤️ Claim", value: info.canClaim ? "✅ Hazır!" : formatTime(info.claimResetTime), inline: true },
                        { name: "💰 Bakiye", value: `${info.shorecoins} SC`, inline: true },
                        { name: "📅 Günlük", value: info.canClaimDaily ? "✅ Alabilirsin!" : formatTime(info.dailyResetTime), inline: true },
                        { name: "🎴 Karakter", value: `${info.characterCount} adet`, inline: true },
                        { name: "🎁 Bonus Claim", value: `${info.bonusClaims}`, inline: true },
                        { name: "🎰 Bonus Roll", value: `${info.bonusRolls}`, inline: true }
                    )
                    .setTimestamp();

                await message.reply({ embeds: [embed] });
                break;
            }

            case "özellik":
            case "ozellik":
            case "upgrade": {
                const embed = new EmbedBuilder()
                    .setTitle("🎁 Özellik Mağazası")
                    .setColor(0xF1C40F)
                    .setDescription("ShoreCoin harcayarak bonus özellikler satın al!")
                    .addFields(
                        { name: "1️⃣ +1 Claim Hakkı", value: "💰 30,000 SC\n`.satınal claim`", inline: true },
                        { name: "2️⃣ +5 Roll Hakkı", value: "💰 20,000 SC\n`.satınal roll`", inline: true }
                    )
                    .setFooter({ text: "Satın almak için: .satınal <claim/roll>" })
                    .setTimestamp();

                await message.reply({ embeds: [embed] });
                break;
            }

            case "satınal":
            case "satinal":
            case "buy": {
                const type = args[0]?.toLowerCase();
                const user = getOrCreateUser(message.author.id) as any;

                if (!type || !["claim", "roll"].includes(type)) {
                    await message.reply("❌ Kullanım: `.satınal <claim/roll>`");
                    break;
                }

                if (type === "claim") {
                    if (user.shorecoins < 30000) {
                        await message.reply(`❌ Yeterli bakiyen yok! Gereken: 30,000 SC, Bakiyen: ${user.shorecoins.toLocaleString()} SC`);
                        break;
                    }
                    updateUserCoins(message.author.id, -30000);
                    addBonusClaim(message.author.id, 1);
                    await message.reply("✅ +1 Claim hakkı satın alındı! 🎁");
                } else if (type === "roll") {
                    if (user.shorecoins < 20000) {
                        await message.reply(`❌ Yeterli bakiyen yok! Gereken: 20,000 SC, Bakiyen: ${user.shorecoins.toLocaleString()} SC`);
                        break;
                    }
                    updateUserCoins(message.author.id, -20000);
                    addBonusRoll(message.author.id, 5);
                    await message.reply("✅ +5 Roll hakkı satın alındı! 🎰");
                }
                break;
            }


            case "karakterlerim":
            case "kl":
            case "chars": {
                const characters = getUserCharacters(message.author.id) as any[];

                if (characters.length === 0) {
                    await message.reply("❌ Henüz hiç karakterin yok! `.roll` komutuyla karakter toplamaya başla.");
                    break;
                }

                // Tekrar eden karakterleri kaldır (character_id bazlı)
                const uniqueCharacters = characters.filter((char, index, self) =>
                    index === self.findIndex((c) => c.character_id === char.character_id)
                );

                const embed = new EmbedBuilder()
                    .setTitle(`🎴 ${message.author.username} - Karakterler`)
                    .setColor(0x3498DB)
                    .setDescription(
                        uniqueCharacters
                            .slice(0, 15)
                            .map((c: any) => `💰 ${c.value || 100} SC | **#${c.rank}** ${getRankEmoji(c.rank)} ${c.name} (${c.series}) - Lv.${c.level}`)
                            .join("\n")
                    )
                    .setFooter({ text: `Toplam: ${uniqueCharacters.length} karakter` })
                    .setTimestamp();

                // En değerli karakterin resmi
                const topChar = uniqueCharacters[0];
                let klAttachment = null;
                if (topChar?.image_url) {
                    if (topChar.image_url.startsWith("http")) {
                        embed.setThumbnail(topChar.image_url);
                    } else if (existsSync(topChar.image_url)) {
                        const safeFileName = `kl_${topChar.id || Date.now()}.jpg`;
                        klAttachment = new AttachmentBuilder(topChar.image_url, { name: safeFileName });
                        embed.setThumbnail(`attachment://${safeFileName}`);
                    }
                }

                const klOptions: any = { embeds: [embed] };
                if (klAttachment) klOptions.files = [klAttachment];
                await message.reply(klOptions);
                break;
            }

            case "karakter":
            case "char": {
                const searchName = args.join(" ").trim();

                if (!searchName) {
                    await message.reply("❌ Karakter ismi gir! Örnek: `.karakter Naruto`");
                    break;
                }

                const character = getCharacterByName(searchName) as any;

                if (!character) {
                    await message.reply(`❌ "${searchName}" isimli karakter bulunamadı!`);
                    break;
                }

                // Karakterin tüm resimlerini al
                const images = getCharacterImages(character.id) as any[];
                const imageIndex = 0;

                const { embed, attachment } = createCharacterEmbed(character, undefined, true);

                // Sahiplik durumu
                if (character.owner_discord_id) {
                    embed.addFields(
                        { name: "Sahip", value: `<@${character.owner_discord_id}>`, inline: true }
                    );
                } else {
                    embed.addFields(
                        { name: "Sahip", value: "❌ Sahipsiz", inline: true }
                    );
                }

                // Resim sayısı bilgisi
                if (images.length > 1) {
                    embed.setFooter({ text: `Resim 1/${images.length} | Butonlarla gezin` });
                }

                const charOptions: any = { embeds: [embed] };
                if (attachment) charOptions.files = [attachment];

                // Birden fazla resim varsa butonlar ekle
                if (images.length > 1) {
                    const prevBtn = new ButtonBuilder()
                        .setCustomId(`char_img_prev_${character.id}_0`)
                        .setLabel("◀️ Önceki")
                        .setStyle(ButtonStyle.Secondary);

                    const nextBtn = new ButtonBuilder()
                        .setCustomId(`char_img_next_${character.id}_0`)
                        .setLabel("Sonraki ▶️")
                        .setStyle(ButtonStyle.Secondary);

                    const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(prevBtn, nextBtn);
                    charOptions.components = [navRow];
                }

                await message.reply(charOptions);
                break;
            }

            // ==================== SERİ GÖRÜNTÜLEME ====================
            case "seri":
            case "series": {
                const seriesName = args.join(" ").trim();

                if (!seriesName) {
                    await message.reply("❌ Seri ismi gir! Örnek: `.seri Naruto`");
                    break;
                }

                // Serideki tüm karakterleri bul
                const seriesCharacters = db.query(`
                    SELECT c.*, uc.id as user_char_id, u.discord_id as owner_discord_id
                    FROM characters c
                    LEFT JOIN user_characters uc ON c.id = uc.character_id
                    LEFT JOIN users u ON uc.user_id = u.id
                    WHERE LOWER(c.series) LIKE LOWER(?)
                    ORDER BY c.rank ASC
                `).all(`%${seriesName}%`) as any[];

                if (seriesCharacters.length === 0) {
                    await message.reply(`❌ "${seriesName}" serisinde karakter bulunamadı!`);
                    break;
                }

                // Seri ismini al (ilk karakterden)
                const actualSeriesName = seriesCharacters[0].series;

                // Cinsiyet emojisi fonksiyonu
                const getGenderEmoji = (gender: string) => {
                    if (gender === "male" || gender === "Male") return " ♂️";
                    if (gender === "female" || gender === "Female") return " ♀️";
                    return "";
                };

                const seriesEmbed = new EmbedBuilder()
                    .setTitle(`🎌 ${actualSeriesName}`)
                    .setColor(0x9B59B6)
                    .setDescription(
                        seriesCharacters
                            .slice(0, 20)
                            .map((c: any) => {
                                const genderEmoji = getGenderEmoji(c.gender);
                                const ownerText = c.owner_discord_id ? ` • <@${c.owner_discord_id}>` : "";
                                return `**#${c.rank}** ${getRankEmoji(c.rank)} ${c.name}${genderEmoji} | ${c.value} SC${ownerText}`;
                            })
                            .join("\n")
                    )
                    .setFooter({ text: `Toplam: ${seriesCharacters.length} karakter${seriesCharacters.length > 20 ? " (ilk 20 gösteriliyor)" : ""}` })
                    .setTimestamp();

                // İlk karakterin resmini ekle
                if (seriesCharacters[0].image_url && seriesCharacters[0].image_url.startsWith("http")) {
                    seriesEmbed.setThumbnail(seriesCharacters[0].image_url);
                }

                await message.reply({ embeds: [seriesEmbed] });
                break;
            }

            // ==================== İSİM DEĞİŞTİRME ====================
            case "isim":
            case "ad":
            case "rename": {
                // Format: .isim eski_isim -> yeni_isim
                const fullText = args.join(" ").trim();

                // -> veya > ile ayır
                let parts = fullText.split("->");
                if (parts.length < 2) {
                    parts = fullText.split(">");
                }

                if (parts.length < 2 || !parts[0]?.trim() || !parts[1]?.trim()) {
                    await message.reply("❌ Kullanım: `.isim eski_isim -> yeni_isim`\nÖrnek: `.isim Naruto Uzumaki -> Naruto`");
                    break;
                }

                const oldName = parts[0].trim();
                const newName = parts[1].trim();

                const result = renameCharacter(oldName, newName);

                if (result.success) {
                    const char = result.character;
                    await message.reply(`✅ Karakter ismi değiştirildi!\n**Eski:** ${oldName}\n**Yeni:** ${newName}\n**Seri:** ${char.series}`);
                } else {
                    await message.reply(result.message!);
                }
                break;
            }

            // ==================== GELİŞTİRME ====================
            case "gelistir":
            case "upgrade": {
                const characterName = args.join(" ").trim();

                if (!characterName) {
                    await message.reply("❌ Karakter ismi gir! Örnek: `.gelistir Naruto`");
                    break;
                }

                const userChar = getUserCharacterByName(message.author.id, characterName) as any;

                if (!userChar) {
                    await message.reply(`❌ "${characterName}" isimli bir karakterin yok!`);
                    break;
                }

                const cost = 50 * userChar.level; // Her seviye daha pahalı
                const result = upgradeCharacter(userChar.id, cost, message.author.id);

                if (result.success) {
                    await message.reply(`✅ **${userChar.name}** seviye ${userChar.level + 1}'e yükseltildi!\n💰 ${cost} SC harcandı | 📈 Değer +${result.valueIncrease} SC arttı!`);
                } else {
                    await message.reply(result.message!);
                }
                break;
            }

            // ==================== AÇIK ARTIRMA ====================
            case "satisacikar":
            case "auction": {
                // Args'ı parse et: son iki sayı fiyat ve süre, geri kalanı isim
                const allArgs = args.join(" ").trim();

                // Regex ile son iki sayıyı bul
                const match = allArgs.match(/^(.+?)\s+(\d+)\s+(\d+)$/);
                let characterName: string;
                let startPrice: number;
                let duration: number;

                if (match && match[1] && match[2] && match[3]) {
                    characterName = match[1].trim();
                    startPrice = parseInt(match[2]) || 100;
                    duration = parseInt(match[3]) || 30;
                } else {
                    // Sadece isim verilmiş olabilir
                    const match2 = allArgs.match(/^(.+?)\s+(\d+)$/);
                    if (match2 && match2[1] && match2[2]) {
                        characterName = match2[1].trim();
                        startPrice = parseInt(match2[2]) || 100;
                        duration = 30;
                    } else {
                        characterName = allArgs;
                        startPrice = 100;
                        duration = 30;
                    }
                }

                if (!characterName) {
                    await message.reply("❌ Kullanım: `.satisacikar <karakter_ismi> [başlangıç_fiyatı] [dakika]`\nÖrnek: `.satisacikar Naruto 500 60`");
                    break;
                }

                const userChar = getUserCharacterByName(message.author.id, characterName) as any;

                if (!userChar) {
                    await message.reply(`❌ "${characterName}" isimli bir karakterin yok!`);
                    break;
                }

                // Bu karakter zaten açık artırmada mı kontrol et
                const existingAuctions = getActiveAuctions() as any[];
                const alreadyInAuction = existingAuctions.find((a: any) => a.user_character_id === userChar.id);
                if (alreadyInAuction) {
                    await message.reply(`❌ **${userChar.name}** zaten açık artırmada! Önce mevcut açık artırmayı iptal et.`);
                    break;
                }

                const user = getOrCreateUser(message.author.id) as any;
                const auction = createAuction(user.id, userChar.id, startPrice, duration, message.channelId) as any;

                if (!auction) {
                    await message.reply("❌ Açık artırma oluşturulamadı! Lütfen tekrar dene.");
                    break;
                }

                const embed = new EmbedBuilder()
                    .setTitle("🔨 Açık Artırma Başlatıldı!")
                    .setDescription(`**${userChar.name}** (${userChar.series}) açık artırmaya çıkarıldı!`)
                    .setColor(0xF39C12)
                    .addFields(
                        { name: "Başlangıç Fiyatı", value: `${startPrice} SC`, inline: true },
                        { name: "Süre", value: `${duration} dakika`, inline: true },
                        { name: "Açık Artırma ID", value: `#${auction.id}`, inline: true }
                    )
                    .setFooter({ text: "Teklif vermek için: .teklif <karakter_ismi> <miktar>" })
                    .setTimestamp();

                // Resim ekleme - lokal dosya ise attachment olarak gönder
                let auctionAttachment = null;
                if (userChar.image_url) {
                    if (userChar.image_url.startsWith("http")) {
                        embed.setThumbnail(userChar.image_url);
                    } else if (existsSync(userChar.image_url)) {
                        const safeFileName = `auction_${userChar.id || Date.now()}.jpg`;
                        auctionAttachment = new AttachmentBuilder(userChar.image_url, { name: safeFileName });
                        embed.setThumbnail(`attachment://${safeFileName}`);
                    }
                }

                const auctionReplyOptions: any = { embeds: [embed] };
                if (auctionAttachment) auctionReplyOptions.files = [auctionAttachment];
                await message.reply(auctionReplyOptions);
                break;
            }

            case "teklif":
            case "bid": {
                // Args'ı parse et: son sayı miktar, geri kalanı isim
                const allArgs = args.join(" ").trim();
                const match = allArgs.match(/^(.+?)\s+(\d+)$/);

                if (!match || !match[1] || !match[2]) {
                    await message.reply("❌ Kullanım: `.teklif <karakter_ismi> <miktar>`\nÖrnek: `.teklif Naruto 500`");
                    break;
                }

                const characterName = match[1].trim();
                const amount = parseInt(match[2]);

                const auction = getAuctionByCharacterName(characterName) as any;

                if (!auction) {
                    await message.reply(`❌ "${characterName}" isimli aktif bir açık artırma bulunamadı!`);
                    break;
                }

                // Satıcının kendi açık artırmasına teklif vermesini engelle
                if (auction.seller_discord_id === message.author.id) {
                    await message.reply(`❌ Kendi açık artırmana teklif veremezsin!`);
                    break;
                }

                const user = getOrCreateUser(message.author.id) as any;
                const result = placeBid(auction.id, user.id, amount);

                if (result.success) {
                    await message.reply(`✅ **${auction.name}** için **${amount} SC** teklif verildi!`);
                } else {
                    await message.reply(result.message!);
                }
                break;
            }

            case "acikartirmalar":
            case "auctions": {
                const auctions = getActiveAuctions() as any[];

                // Süresi dolmamış açık artırmaları filtrele
                const activeAuctions = auctions.filter((a: any) => {
                    const timeLeft = new Date(a.ends_at).getTime() - Date.now();
                    return timeLeft > 0;
                });

                if (activeAuctions.length === 0) {
                    await message.reply("❌ Şu anda aktif açık artırma yok!");
                    break;
                }

                // Karakter başına sadece bir açık artırma göster (en son oluşturulanı)
                const uniqueAuctions = activeAuctions.filter((auction, index, self) =>
                    index === self.findIndex((a) => a.user_character_id === auction.user_character_id)
                );

                const embed = new EmbedBuilder()
                    .setTitle("🔨 Aktif Açık Artırmalar")
                    .setColor(0xF39C12)
                    .setDescription(
                        uniqueAuctions
                            .slice(0, 10)
                            .map((a: any) => {
                                const timeLeft = Math.max(0, Math.floor((new Date(a.ends_at).getTime() - Date.now()) / 60000));
                                return `**#${a.id}** - ${getRankEmoji(a.rank)} ${a.name} | ${a.current_bid} SC | ⏰ ${timeLeft}dk`;
                            })
                            .join("\n")
                    )
                    .setFooter({ text: "Teklif vermek için: .teklif <karakter_ismi> <miktar>" })
                    .setTimestamp();

                await message.reply({ embeds: [embed] });
                break;
            }

            // ==================== TAKAS ====================
            case "takas":
            case "trade": {
                const targetUser = message.mentions.users.first();

                if (!targetUser) {
                    await message.reply("❌ Kullanım: `.takas @kullanıcı <teklif_karakter_ismi> <istek_karakter_ismi>`\nÖrnek: `.takas @user Naruto Sasuke`");
                    break;
                }

                if (targetUser.id === message.author.id) {
                    await message.reply("❌ Kendinle takas yapamazsın!");
                    break;
                }

                // @mention'dan sonraki argümanları al
                const remainingArgs = args.slice(1).join(" ").trim();
                const charNames = remainingArgs.split(/\s+/);

                if (charNames.length < 2 || !charNames[0] || !charNames[1]) {
                    await message.reply("❌ İki karakter ismi gir! Örnek: `.takas @user Naruto Sasuke`");
                    break;
                }

                const offerCharName = charNames[0];
                const requestCharName = charNames[1];

                const fromUser = getOrCreateUser(message.author.id) as any;
                const toUser = getOrCreateUser(targetUser.id) as any;

                // Teklif edilen karakter kontrolü
                const offerChar = getUserCharacterByName(message.author.id, offerCharName) as any;
                if (!offerChar) {
                    await message.reply(`❌ "${offerCharName}" isimli bir karakterin yok!`);
                    break;
                }

                // İstenen karakter kontrolü
                const requestChar = getUserCharacterByName(targetUser.id, requestCharName) as any;
                if (!requestChar) {
                    await message.reply(`❌ "${requestCharName}" isimli karakter ${targetUser} kullanıcısına ait değil!`);
                    break;
                }

                const trade = createTrade(fromUser.id, toUser.id, offerChar.id, 0, requestChar.id, 0);

                await message.reply(`✅ ${targetUser} kullanıcısına takas teklifi gönderildi!\n📤 **Teklif:** ${offerChar.name}\n📥 **İstek:** ${requestChar.name}`);
                break;
            }

            case "takaslarim":
            case "trades": {
                const trades = getPendingTrades(message.author.id) as any[];

                if (trades.length === 0) {
                    await message.reply("❌ Bekleyen takas teklifin yok!");
                    break;
                }

                const embeds = trades.slice(0, 5).map((t: any) => createTradeEmbed(t, `<@${t.from_discord_id}>`));
                await message.reply({ embeds });
                break;
            }

            case "takaskabul":
            case "accepttrade": {
                const characterName = args.join(" ").trim();

                if (!characterName) {
                    await message.reply("❌ Karakter ismi gir! Örnek: `.takaskabul Naruto`");
                    break;
                }

                const trade = getTradeByCharacterName(message.author.id, characterName) as any;

                if (!trade) {
                    await message.reply(`❌ "${characterName}" ile ilgili bekleyen bir takas teklifi bulunamadı!`);
                    break;
                }

                const result = acceptTrade(trade.id);

                if (result.success) {
                    await message.reply(`✅ Takas kabul edildi! **${trade.offer_char_name || ""}** ↔ **${trade.request_char_name || ""}** transfer edildi.`);
                } else {
                    await message.reply(result.message!);
                }
                break;
            }

            case "takasreddet":
            case "rejecttrade": {
                const characterName = args.join(" ").trim();

                if (!characterName) {
                    await message.reply("❌ Karakter ismi gir! Örnek: `.takasreddet Naruto`");
                    break;
                }

                const trade = getTradeByCharacterName(message.author.id, characterName) as any;

                if (!trade) {
                    await message.reply(`❌ "${characterName}" ile ilgili bekleyen bir takas teklifi bulunamadı!`);
                    break;
                }

                rejectTrade(trade.id);
                await message.reply(`✅ **${trade.offer_char_name || characterName}** takası reddedildi!`);
                break;
            }

            // ==================== KOŞULSUZ TAKAS (HEDİYE) ====================
            case "kosulsuztakas":
            case "hediye":
            case "gift": {
                const targetUser = message.mentions.users.first();

                if (!targetUser) {
                    await message.reply("❌ Kullanım: `.kosulsuztakas @kullanıcı <karakter_ismi>`\nÖrnek: `.kosulsuztakas @user Naruto`");
                    break;
                }

                if (targetUser.id === message.author.id) {
                    await message.reply("❌ Kendine karakter veremezsin!");
                    break;
                }

                // @mention'dan sonraki argümanları al (karakter ismi)
                const charName = args.slice(1).join(" ").trim();

                if (!charName) {
                    await message.reply("❌ Karakter ismi gir! Örnek: `.kosulsuztakas @user Naruto`");
                    break;
                }

                // Gönderen kullanıcının karakteri kontrolü
                const giftChar = getUserCharacterByName(message.author.id, charName) as any;
                if (!giftChar) {
                    await message.reply(`❌ "${charName}" isimli bir karakterin yok!`);
                    break;
                }

                // Alan kullanıcıyı oluştur/al
                const toUser = getOrCreateUser(targetUser.id) as any;

                // Karakteri direkt transfer et
                db.run("UPDATE user_characters SET user_id = ? WHERE id = ?", [toUser.id, giftChar.id]);

                const embed = new EmbedBuilder()
                    .setTitle("🎁 Karakter Hediye Edildi!")
                    .setDescription(`**${giftChar.name}** (${giftChar.series}) artık ${targetUser}'e ait!`)
                    .setColor(0x2ECC71)
                    .addFields(
                        { name: "Gönderen", value: `${message.author}`, inline: true },
                        { name: "Alan", value: `${targetUser}`, inline: true },
                        { name: "Sıralama", value: `#${giftChar.rank}`, inline: true }
                    )
                    .setTimestamp();

                // Resim ekleme
                if (giftChar.image_url) {
                    if (giftChar.image_url.startsWith("http")) {
                        embed.setThumbnail(giftChar.image_url);
                    }
                }

                await message.reply({ embeds: [embed] });
                break;
            }

            // ==================== AÇIK ARTIRMA SİL ====================
            case "acikartirmasil":
            case "cancelauction": {
                const characterName = args.join(" ").trim();

                if (!characterName) {
                    await message.reply("❌ Karakter ismi gir! Örnek: `.acikartirmasil Naruto`");
                    break;
                }

                const auction = getAuctionByCharacterName(characterName) as any;

                if (!auction) {
                    await message.reply(`❌ "${characterName}" isimli aktif bir açık artırma bulunamadı!`);
                    break;
                }

                const result = deleteAuction(auction.id, message.author.id);

                if (result.success) {
                    await message.reply(`✅ **${auction.name}** açık artırması iptal edildi!`);
                } else {
                    await message.reply(result.message!);
                }
                break;
            }

            // ==================== TOPLU KOMUTLAR ====================
            case "bütünkarakterlerisat":
            case "butunkarakterlerisat":
            case "sellall": {
                const characters = getUserCharacters(message.author.id) as any[];

                if (characters.length === 0) {
                    await message.reply("❌ Satılacak karakterin yok!");
                    break;
                }

                // Toplam değer hesapla
                let totalValue = 0;
                for (const char of characters) {
                    totalValue += char.value || 100;
                }

                // Tüm karakterleri sil
                db.run(`DELETE FROM user_characters WHERE user_id = (SELECT id FROM users WHERE discord_id = ?)`, [message.author.id]);

                // Parayı ver
                updateUserCoins(message.author.id, totalValue);

                await message.reply(`💰 **${characters.length} karakter** satıldı!\n✅ Toplam: **${totalValue.toLocaleString()} SC** kazandın!`);
                break;
            }

            case "sunucurestart":
            case "serverrestart": {
                // Admin kontrolü
                if (!message.member?.permissions.has("Administrator")) {
                    await message.reply("❌ Bu komutu kullanmak için yönetici olmalısın!");
                    break;
                }

                // Tüm kullanıcıların karakterlerinin değerini hesapla ve para olarak ver
                const allUserCharacters = db.query(`
                    SELECT uc.user_id, u.discord_id, c.value 
                    FROM user_characters uc
                    JOIN users u ON uc.user_id = u.id
                    JOIN characters c ON uc.character_id = c.id
                `).all() as any[];

                // Kullanıcı başına toplam değer
                const userTotals: { [key: string]: number } = {};
                for (const uc of allUserCharacters) {
                    if (!userTotals[uc.discord_id]) userTotals[uc.discord_id] = 0;
                    userTotals[uc.discord_id] += uc.value || 100;
                }

                // Her kullanıcıya parasını ver
                for (const [discordId, value] of Object.entries(userTotals)) {
                    updateUserCoins(discordId, value);
                }

                // Tüm sahiplikleri sil
                db.run(`DELETE FROM user_characters`);

                // Aktif spawn'ları temizle
                activeSpawns.clear();

                const userCount = Object.keys(userTotals).length;
                const totalChars = allUserCharacters.length;

                await message.reply(`🔄 **Sunucu sıfırlandı!**\n\n📊 ${userCount} kullanıcının ${totalChars} karakteri satıldı\n💰 Herkes karakterlerinin değerini ShoreCoin olarak aldı!`);
                break;
            }

            // ==================== ADMİN ====================
            case "karakterekle":
            case "addchar": {
                // Sunucu sahibi kontrolü
                if (message.guild?.ownerId !== message.author.id) {
                    await message.reply("❌ Bu komutu sadece sunucu sahibi kullanabilir!");
                    break;
                }

                // Kategori seçim menüsü oluştur
                const categorySelect = new StringSelectMenuBuilder()
                    .setCustomId("character_category_select")
                    .setPlaceholder("📁 Kategori Seç")
                    .addOptions(
                        new StringSelectMenuOptionBuilder().setLabel("🎌 Anime").setValue("Anime").setDescription("Anime karakterleri"),
                        new StringSelectMenuOptionBuilder().setLabel("🎬 Film").setValue("Film").setDescription("Film karakterleri"),
                        new StringSelectMenuOptionBuilder().setLabel("📺 Dizi").setValue("Dizi").setDescription("Dizi karakterleri"),
                        new StringSelectMenuOptionBuilder().setLabel("😂 Meme").setValue("Meme").setDescription("Meme karakterleri"),
                        new StringSelectMenuOptionBuilder().setLabel("📱 Webtoon").setValue("Webtoon").setDescription("Webtoon karakterleri"),
                        new StringSelectMenuOptionBuilder().setLabel("📚 Manhwa").setValue("Manhwa").setDescription("Manhwa karakterleri"),
                    );

                const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(categorySelect);

                const embed = new EmbedBuilder()
                    .setTitle("🎴 Karakter Ekle")
                    .setDescription("Önce bir kategori seç, sonra karakter bilgilerini girebileceğin bir form açılacak.")
                    .setColor(0x9B59B6)
                    .addFields(
                        { name: "Kategoriler", value: "🎌 Anime | 🎬 Film | 📺 Dizi | 😂 Meme | 📱 Webtoon | 📚 Manhwa" }
                    );

                await message.reply({ embeds: [embed], components: [selectRow] });
                break;
            }

            case "karakterler":
            case "allchars": {
                const pageNum = parseInt(args[0]) || 1;
                const result = getCharactersPaginated(pageNum, 15);

                if (result.characters.length === 0) {
                    await message.reply("❌ Sistemde henüz karakter yok!");
                    break;
                }

                const embed = new EmbedBuilder()
                    .setTitle(`🎴 Tüm Karakterler (Sayfa ${result.page}/${result.totalPages})`)
                    .setColor(0x9B59B6)
                    .setDescription(
                        result.characters
                            .map((c: any) => `**#${c.rank}** ${getRankEmoji(c.rank)} ${c.name} (${c.series})`)
                            .join("\n")
                    )
                    .setFooter({ text: `Toplam: ${result.total} karakter | Sayfa: ${result.page}/${result.totalPages}` })
                    .setTimestamp();

                // Sayfalama butonları
                const prevButton = new ButtonBuilder()
                    .setCustomId(`chars_page_${pageNum - 1}`)
                    .setLabel("◀️ Önceki")
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(pageNum <= 1);

                const nextButton = new ButtonBuilder()
                    .setCustomId(`chars_page_${pageNum + 1}`)
                    .setLabel("Sonraki ▶️")
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(pageNum >= result.totalPages);

                const pageRow = new ActionRowBuilder<ButtonBuilder>().addComponents(prevButton, nextButton);

                await message.reply({ embeds: [embed], components: [pageRow] });
                break;
            }


            // ==================== RESİM YÖNETİMİ ====================
            case "resimekle":
            case "addimage": {
                // Sunucu sahibi kontrolü
                if (message.guild?.ownerId !== message.author.id) {
                    await message.reply("❌ Bu komutu sadece sunucu sahibi kullanabilir!");
                    break;
                }

                const argsText = args.join(" ").trim();

                // Pattern: karakter_ismi URL veya karakter_ismi yerel
                const urlMatch = argsText.match(/^(.+?)\s+(https?:\/\/.+)$/i);
                const localMatch = argsText.match(/^(.+?)\s+yerel$/i);

                if (urlMatch && urlMatch[1] && urlMatch[2]) {
                    // URL ile resim ekleme
                    const charName = urlMatch[1].trim();
                    const imageUrl = urlMatch[2].trim();

                    const character = getCharacterByName(charName) as any;
                    if (!character) {
                        await message.reply(`❌ "${charName}" isimli karakter bulunamadı!`);
                        break;
                    }

                    addCharacterImage(character.id, imageUrl, false);
                    await message.reply(`✅ **${character.name}** karakterine resim eklendi!\n🔗 URL: ${imageUrl}`);
                } else if (localMatch && localMatch[1]) {
                    // Yerel dosyadan resim ekleme
                    const charName = localMatch[1].trim();

                    const character = getCharacterByName(charName) as any;
                    if (!character) {
                        await message.reply(`❌ "${charName}" isimli karakter bulunamadı!`);
                        break;
                    }

                    // Yerel dosyayı ara
                    const localImages = findAllCharacterImages(charName);
                    if (localImages.length === 0) {
                        await message.reply(`❌ "${charName}" için yerel resim dosyası bulunamadı!`);
                        break;
                    }

                    // Tüm bulunan resimleri ekle
                    let addedCount = 0;
                    for (const img of localImages) {
                        addCharacterImage(character.id, img.path, true);
                        addedCount++;
                    }

                    await message.reply(`✅ **${character.name}** karakterine ${addedCount} yerel resim eklendi!`);
                } else {
                    await message.reply("❌ Kullanım:\n`.resimekle <karakter_ismi> <url>` - URL ile resim ekle\n`.resimekle <karakter_ismi> yerel` - Yerel dosyadan resim ekle");
                }
                break;
            }

            case "resimsil":
            case "removeimage": {
                // Sunucu sahibi kontrolü
                if (message.guild?.ownerId !== message.author.id) {
                    await message.reply("❌ Bu komutu sadece sunucu sahibi kullanabilir!");
                    break;
                }

                const argsText = args.join(" ").trim();
                const siMatch = argsText.match(/^(.+?)\s+(\d+)$/);

                if (siMatch && siMatch[1] && siMatch[2]) {
                    const charName = siMatch[1].trim();
                    const imageIndex = parseInt(siMatch[2]);

                    const images = getCharacterImagesByName(charName) as any[];
                    if (images.length === 0) {
                        await message.reply(`❌ "${charName}" karakterinin resmi yok!`);
                        break;
                    }

                    if (imageIndex < 1 || imageIndex > images.length) {
                        await message.reply(`❌ Geçersiz resim numarası! 1-${images.length} arasında olmalı.`);
                        break;
                    }

                    const imageToRemove = images[imageIndex - 1];
                    removeCharacterImage(imageToRemove.id);
                    await message.reply(`✅ Resim #${imageIndex} silindi!`);
                } else {
                    await message.reply("❌ Kullanım: `.resimsil <karakter_ismi> <resim_no>`");
                }
                break;
            }

            case "resimler":
            case "images": {
                const imgCharName = args.join(" ").trim();

                if (!imgCharName) {
                    await message.reply("❌ Karakter ismi gir! Örnek: `.resimler Naruto`");
                    break;
                }

                const character = getCharacterByName(imgCharName) as any;
                if (!character) {
                    await message.reply(`❌ "${imgCharName}" isimli karakter bulunamadı!`);
                    break;
                }

                const images = getCharacterImages(character.id) as any[];

                if (images.length === 0) {
                    // Yerel resimleri de kontrol et
                    const localImages = findAllCharacterImages(imgCharName);
                    if (localImages.length > 0) {
                        const localList = localImages.map((img, i) => `**${i + 1}.** 📁 ${img.path.split(/[/\\]/).pop()}`).join("\n");
                        await message.reply(`📷 **${character.name}** - Kullanılabilir Yerel Resimler:\n${localList}\n\n💡 Bu resimleri eklemek için: \`.resimekle ${imgCharName} yerel\``);
                    } else {
                        await message.reply(`❌ "${character.name}" karakterinin resmi yok!`);
                    }
                    break;
                }

                const imageList = images.map((img: any, i: number) => {
                    const type = img.is_local ? "📁 Yerel" : "🔗 URL";
                    const source = img.is_local ? img.image_url.split(/[/\\]/).pop() : img.image_url.substring(0, 50) + "...";
                    return `**${i + 1}.** ${type}: ${source}`;
                }).join("\n");

                const imgEmbed = new EmbedBuilder()
                    .setTitle(`📷 ${character.name} - Resimler`)
                    .setDescription(imageList)
                    .setColor(0x3498DB)
                    .setFooter({ text: `Toplam: ${images.length} resim` })
                    .setTimestamp();

                // İlk resmi göster
                if (images[0]) {
                    if (images[0].is_local) {
                        const attachment = new AttachmentBuilder(images[0].image_url);
                        imgEmbed.setThumbnail(`attachment://${images[0].image_url.split(/[/\\]/).pop()}`);
                        await message.reply({ embeds: [imgEmbed], files: [attachment] });
                    } else {
                        imgEmbed.setThumbnail(images[0].image_url);
                        await message.reply({ embeds: [imgEmbed] });
                    }
                } else {
                    await message.reply({ embeds: [imgEmbed] });
                }
                break;
            }

            // ==================== KARAKTER SAT ====================
            case "karaktersat":
            case "sat":
            case "sell": {
                const characterName = args.join(" ").trim();

                if (!characterName) {
                    await message.reply("❌ Karakter ismi gir! Örnek: `.karaktersat Naruto`");
                    break;
                }

                const result = sellCharacter(message.author.id, characterName);

                if (result.success) {
                    const embed = new EmbedBuilder()
                        .setTitle("💰 Karakter Satıldı!")
                        .setDescription(`**${result.characterName}** (${result.series}) karakterini sattın!`)
                        .setColor(0x2ECC71)
                        .addFields(
                            { name: "💵 Kazanılan ShoreCoin", value: `${result.value} SC`, inline: true }
                        )
                        .setTimestamp();

                    await message.reply({ embeds: [embed] });
                } else {
                    await message.reply(result.message!);
                }
                break;
            }

            default:
                // Bilinmeyen komut - sessizce ignore et
                break;
        }
    } catch (error) {
        console.error("Komut hatası:", error);
        await message.reply("❌ Bir hata oluştu! Lütfen tekrar dene.").catch(() => { });
    }
});

// InteractionCreate - Button, SelectMenu ve Modal işlemleri
client.on(Events.InteractionCreate, async (interaction) => {
    try {
        // Button - Sahiplenme butonu
        if (interaction.isButton() && interaction.customId.startsWith("claim_")) {
            const parts = interaction.customId.split("_");
            const characterId = parseInt(parts[1] || "0");
            const messageId = parts[2] || "";

            const spawn = activeSpawns.get(messageId);

            if (!spawn) {
                await interaction.reply({ content: "❌ Bu karakter artık sahiplenilemez!", ephemeral: true });
                return;
            }

            if (spawn.claimed) {
                await interaction.reply({ content: `❌ Bu karakter zaten sahiplenildi!`, ephemeral: true });
                return;
            }

            if (spawn.character.id !== characterId) {
                await interaction.reply({ content: "❌ Bu karakter artık mevcut değil!", ephemeral: true });
                return;
            }

            // Claim cooldown kontrolü (2 saat) - bonus claim dahil
            const claimStatus = canClaimCharacter(interaction.user.id);
            if (!claimStatus.canClaim) {
                const resetTime = claimStatus.resetAt;
                const minutesLeft = resetTime ? Math.ceil((resetTime.getTime() - Date.now()) / 60000) : 120;
                const hoursLeft = Math.floor(minutesLeft / 60);
                const minsLeft = minutesLeft % 60;
                await interaction.reply({
                    content: `❌ Claim hakkın yok! ${hoursLeft > 0 ? `${hoursLeft}s ` : ""}${minsLeft}dk sonra tekrar dene.`,
                    ephemeral: true
                });
                return;
            }

            // Karakteri sahiplen
            spawn.claimed = true;
            spawn.claimed_by = interaction.user.id;

            const dbUser = getOrCreateUser(interaction.user.id) as any;
            giveCharacterToUser(dbUser.id, spawn.character.id);

            // Bonus claim kullanılıyorsa bonus'u düşür, yoksa cooldown başlat
            if (claimStatus.usingBonus) {
                useBonusClaim(interaction.user.id);
            } else {
                // Claim cooldown'ı ayarla (2 saat)
                setClaimCooldown(interaction.user.id);
            }

            // Butonu güncelle
            const claimedButton = new ButtonBuilder()
                .setCustomId(`claimed_${characterId}`)
                .setLabel(`✅ ${interaction.user.username} sahiplendi!`)
                .setStyle(ButtonStyle.Success)
                .setDisabled(true);

            const claimedRow = new ActionRowBuilder<ButtonBuilder>().addComponents(claimedButton);

            // Embed'i güncelle
            const { embed, attachment } = createCharacterEmbed(spawn.character, `✅ ${interaction.user.username} sahiplendi!`, true);
            embed.setColor(0x2ECC71);

            const updateOptions: any = { embeds: [embed], components: [claimedRow] };
            if (attachment) {
                updateOptions.files = [attachment];
            }

            await interaction.update(updateOptions);

            // Spawn'ı temizle
            activeSpawns.delete(messageId);
            return;
        }

        // Button - Karakterler Sayfalama
        if (interaction.isButton() && interaction.customId.startsWith("chars_page_")) {
            const pageNum = parseInt(interaction.customId.split("_")[2] || "1");
            const result = getCharactersPaginated(pageNum, 15);

            const embed = new EmbedBuilder()
                .setTitle(`🎴 Tüm Karakterler (Sayfa ${result.page}/${result.totalPages})`)
                .setColor(0x9B59B6)
                .setDescription(
                    result.characters
                        .map((c: any) => `**#${c.rank}** ${getRankEmoji(c.rank)} ${c.name} (${c.series})`)
                        .join("\n")
                )
                .setFooter({ text: `Toplam: ${result.total} karakter | Sayfa: ${result.page}/${result.totalPages}` })
                .setTimestamp();

            const prevButton = new ButtonBuilder()
                .setCustomId(`chars_page_${pageNum - 1}`)
                .setLabel("◀️ Önceki")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(pageNum <= 1);

            const nextButton = new ButtonBuilder()
                .setCustomId(`chars_page_${pageNum + 1}`)
                .setLabel("Sonraki ▶️")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(pageNum >= result.totalPages);

            const pageRow = new ActionRowBuilder<ButtonBuilder>().addComponents(prevButton, nextButton);

            await interaction.update({ embeds: [embed], components: [pageRow] });
            return;
        }

        // Button - Karakter Resim Navigasyonu
        if (interaction.isButton() && (interaction.customId.startsWith("char_img_prev_") || interaction.customId.startsWith("char_img_next_"))) {
            const parts = interaction.customId.split("_");
            const direction = parts[2]; // prev veya next
            const characterId = parseInt(parts[3] || "0");
            const currentIdx = parseInt(parts[4] || "0");

            const character = getCharacterById(characterId) as any;
            if (!character) {
                await interaction.reply({ content: "❌ Karakter bulunamadı!", ephemeral: true });
                return;
            }

            const images = getCharacterImages(characterId) as any[];
            if (images.length === 0) {
                await interaction.reply({ content: "❌ Resim bulunamadı!", ephemeral: true });
                return;
            }

            // Yeni index hesapla
            let newIndex = currentIdx;
            if (direction === "prev") {
                newIndex = (currentIdx - 1 + images.length) % images.length;
            } else {
                newIndex = (currentIdx + 1) % images.length;
            }

            const currentImage = images[newIndex];

            const embed = new EmbedBuilder()
                .setTitle(`${getRankEmoji(character.rank)} ${character.name}`)
                .setDescription(`**Seri:** ${character.series}\n**Sıralama:** #${character.rank}\n**💰 Değer:** ${character.value} SC`)
                .setColor(0x9B59B6)
                .setFooter({ text: `Resim ${newIndex + 1}/${images.length}` })
                .setTimestamp();

            // Resmi ekle - seçilen resmi kullan (currentImage)
            let imgAttachment = null;
            const imgUrl = currentImage?.image_url;
            if (imgUrl?.startsWith("http")) {
                embed.setImage(imgUrl);
            } else if (imgUrl && existsSync(imgUrl)) {
                const safeFileName = `charimg_${character.id}_${newIndex}.jpg`;
                imgAttachment = new AttachmentBuilder(imgUrl, { name: safeFileName });
                embed.setImage(`attachment://${safeFileName}`);
            }

            // Navigasyon butonları
            const prevButton = new ButtonBuilder()
                .setCustomId(`char_img_prev_${characterId}_${newIndex}`)
                .setLabel("◀️ Önceki")
                .setStyle(ButtonStyle.Secondary);

            const nextButton = new ButtonBuilder()
                .setCustomId(`char_img_next_${characterId}_${newIndex}`)
                .setLabel("Sonraki ▶️")
                .setStyle(ButtonStyle.Secondary);

            const imgRow = new ActionRowBuilder<ButtonBuilder>().addComponents(prevButton, nextButton);

            // Eski dosyaları temizle ve yeni resmi ekle
            const updateOptions: any = {
                embeds: [embed],
                components: [imgRow],
                attachments: [], // Eski dosyaları temizle
                files: imgAttachment ? [imgAttachment] : []
            };
            await interaction.update(updateOptions);
            return;
        }

        // SelectMenu - Kategori seçimi
        if (interaction.isStringSelectMenu() && interaction.customId === "character_category_select") {
            const selectedCategory = interaction.values[0];

            // Modal oluştur
            const modal = new ModalBuilder()
                .setCustomId(`add_character_modal_${selectedCategory}`)
                .setTitle(`🎴 ${selectedCategory} Karakteri Ekle`);

            // Karakter ismi input
            const nameInput = new TextInputBuilder()
                .setCustomId("character_name")
                .setLabel("Karakter İsmi")
                .setPlaceholder("Örn: Naruto Uzumaki")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(100);

            // Seri ismi input
            const seriesInput = new TextInputBuilder()
                .setCustomId("character_series")
                .setLabel("Seri/Kaynak İsmi")
                .setPlaceholder("Örn: Naruto Shippuden")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(100);

            // Resim URL input
            const imageInput = new TextInputBuilder()
                .setCustomId("character_image")
                .setLabel("Resim URL (opsiyonel)")
                .setPlaceholder("https://example.com/karakter.jpg")
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setMaxLength(500);

            // Sıralama input
            const rankInput = new TextInputBuilder()
                .setCustomId("character_rank")
                .setLabel("Sıralama (#1 = en değerli)")
                .setPlaceholder("Örn: 1, 50, 100...")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(10);

            // Row'ları oluştur
            const row1 = new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput);
            const row2 = new ActionRowBuilder<TextInputBuilder>().addComponents(seriesInput);
            const row3 = new ActionRowBuilder<TextInputBuilder>().addComponents(imageInput);
            const row4 = new ActionRowBuilder<TextInputBuilder>().addComponents(rankInput);

            modal.addComponents(row1, row2, row3, row4);

            await interaction.showModal(modal);
        }

        // Modal Submit - Karakter ekleme
        if (interaction.isModalSubmit() && interaction.customId.startsWith("add_character_modal_")) {
            const category = interaction.customId.replace("add_character_modal_", "");

            const name = interaction.fields.getTextInputValue("character_name");
            const series = interaction.fields.getTextInputValue("character_series");
            const imageUrl = interaction.fields.getTextInputValue("character_image") || "";
            const rankStr = interaction.fields.getTextInputValue("character_rank");
            const rank = parseInt(rankStr) || 9999;

            // Karakteri ekle
            addCharacter(name, series, category, imageUrl, rank);

            // Kategori emojisi
            const categoryEmojis: Record<string, string> = {
                "Anime": "🎌",
                "Film": "🎬",
                "Dizi": "📺",
                "Meme": "😂",
                "Webtoon": "📱",
                "Manhwa": "📚",
            };

            const embed = new EmbedBuilder()
                .setTitle("✅ Karakter Eklendi!")
                .setColor(0x2ECC71)
                .addFields(
                    { name: "İsim", value: name, inline: true },
                    { name: "Seri", value: series, inline: true },
                    { name: "Kategori", value: `${categoryEmojis[category] || "📁"} ${category}`, inline: true },
                    { name: "Sıralama", value: `#${rank}`, inline: true },
                )
                .setTimestamp();

            if (imageUrl) {
                embed.setThumbnail(imageUrl);
            }

            await interaction.reply({ embeds: [embed], ephemeral: false });
        }
    } catch (error) {
        console.error("Interaction hatası:", error);
        if (interaction.isRepliable()) {
            await interaction.reply({
                content: "❌ Bir hata oluştu! Lütfen tekrar dene.",
                ephemeral: true
            }).catch(() => { });
        }
    }
});

// Reaction Handler - Emoji ile karakter sahiplenme
client.on(Events.MessageReactionAdd, async (reaction, user) => {
    try {
        // Bot'un kendi reaksiyonlarını ignore et
        if (user.bot) return;

        // Partial reaction ise fetch et
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                console.error("Reaction fetch hatası:", error);
                return;
            }
        }

        // Sadece sahiplenme emojisini kontrol et
        if (reaction.emoji.name !== CLAIM_EMOJI) return;

        const messageId = reaction.message.id;
        const spawn = activeSpawns.get(messageId);

        // Aktif spawn var mı kontrol et
        if (!spawn) return;

        // Zaten sahiplenilmiş mi
        if (spawn.claimed) {
            // Kullanıcıya DM at (opsiyonel)
            return;
        }

        // Süre dolmuş mu
        if (Date.now() > spawn.expires_at) {
            activeSpawns.delete(messageId);
            return;
        }

        // Karakteri sahiplen
        spawn.claimed = true;
        spawn.claimed_by = user.id;

        const dbUser = getOrCreateUser(user.id) as any;
        giveCharacterToUser(dbUser.id, spawn.character.id);

        // Başarı mesajı gönder
        const { embed, attachment } = createCharacterEmbed(spawn.character);
        embed.setTitle(`✅ ${user.username} sahiplendi!`);
        embed.setDescription(`**${spawn.character.name}** artık senin!\nSeri: ${spawn.character.series}\nSıralama: #${spawn.character.rank}`);

        const channel = reaction.message.channel;
        if ('send' in channel) {
            const sendOptions: any = { embeds: [embed] };
            if (attachment) sendOptions.files = [attachment];
            await channel.send(sendOptions);
        }

    } catch (error) {
        console.error("Reaction claim hatası:", error);
    }
});

// Botu başlat
const token = process.env.DISCORD_TOKEN;

if (!token) {
    console.error("❌ DISCORD_TOKEN bulunamadı! .env dosyasını kontrol et.");
    process.exit(1);
}

client.login(token);