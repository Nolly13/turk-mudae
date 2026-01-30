import { EmbedBuilder } from "discord.js";
import type { Character } from "../types";

// Rank'a göre renk belirleme
export function getRankColor(rank: number): number {
    if (rank === 1) return 0xFFD700; // Altın - #1
    if (rank <= 5) return 0xE74C3C; // Kırmızı - Top 5
    if (rank <= 10) return 0xE91E63; // Pembe - Top 10
    if (rank <= 25) return 0x9B59B6; // Mor - Top 25
    if (rank <= 50) return 0x3498DB; // Mavi - Top 50
    if (rank <= 100) return 0x2ECC71; // Yeşil - Top 100
    return 0x95A5A6; // Gri - Diğerleri
}

// Rank'a göre emoji
export function getRankEmoji(rank: number): string {
    if (rank === 1) return "👑";
    if (rank <= 5) return "💎";
    if (rank <= 10) return "🔥";
    if (rank <= 25) return "⭐";
    if (rank <= 50) return "✨";
    if (rank <= 100) return "💫";
    return "🌟";
}

// Kategori emojileri
export function getCategoryEmoji(category: string): string {
    const emojis: Record<string, string> = {
        "Anime": "🎌",
        "Film": "🎬",
        "Dizi": "📺",
        "Meme": "😂",
        "Webtoon": "📱",
        "Manhwa": "📚",
    };
    return emojis[category] || "📁";
}

import { AttachmentBuilder } from "discord.js";
import { existsSync } from "fs";
import { basename } from "path";

// Karakter embed'i oluştur - yerel resim desteği ile
export function createCharacterEmbed(character: any, title?: string, useLargeImage: boolean = false): { embed: EmbedBuilder; attachment: AttachmentBuilder | null } {
    const categoryEmoji = character.category ? getCategoryEmoji(character.category) : "";
    const categoryText = character.category ? `\n**Kategori:** ${categoryEmoji} ${character.category}` : "";
    const valueText = character.value ? `\n**💰 Değer:** ${character.value} SC` : "";

    // Cinsiyet emojisi
    let genderEmoji = "";
    if (character.gender === "male" || character.gender === "Male") genderEmoji = " ♂️";
    else if (character.gender === "female" || character.gender === "Female") genderEmoji = " ♀️";

    const embed = new EmbedBuilder()
        .setTitle(title || `${getRankEmoji(character.rank)} ${character.name}${genderEmoji}`)
        .setDescription(`**Seri:** ${character.series}${categoryText}\n**Sıralama:** #${character.rank}${valueText}`)
        .setColor(getRankColor(character.rank))
        .setTimestamp();

    let attachment: AttachmentBuilder | null = null;

    if (character.image_url) {
        if (character.image_url.startsWith("http")) {
            // URL ise doğrudan kullan
            if (useLargeImage) {
                embed.setImage(character.image_url);
            } else {
                embed.setThumbnail(character.image_url);
            }
        } else if (existsSync(character.image_url)) {
            // Yerel dosya ise AttachmentBuilder kullan ve embed'e ekle
            const originalFileName = basename(character.image_url);
            // Dosya adını tamamen güvenli hale getir
            const safeFileName = `char_${character.id || Date.now()}.jpg`;
            attachment = new AttachmentBuilder(character.image_url, { name: safeFileName });

            // Embed'e resmi ekle
            if (useLargeImage) {
                embed.setImage(`attachment://${safeFileName}`);
            } else {
                embed.setThumbnail(`attachment://${safeFileName}`);
            }
        }
    }

    if (character.level) {
        embed.addFields({ name: "Seviye", value: `⬆️ ${character.level}`, inline: true });
    }

    return { embed, attachment };
}

// Kullanıcı profil embed'i
export function createProfileEmbed(user: any, characters: any[]): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setTitle("📊 Profil")
        .setColor(0x3498DB)
        .addFields(
            { name: "💰 ShoreCoin", value: `${user.shorecoins} SC`, inline: true },
            { name: "🎴 Karakter Sayısı", value: `${characters.length}`, inline: true }
        )
        .setTimestamp();

    if (characters.length > 0) {
        const topCharacters = characters.slice(0, 5);
        const charList = topCharacters.map((c: any) => `${getRankEmoji(c.rank)} **#${c.rank}** ${c.name}`).join("\n");
        embed.addFields({ name: "En İyi Karakterler", value: charList || "Yok" });
    }

    return embed;
}

// Açık artırma embed'i
export function createAuctionEmbed(auction: any): EmbedBuilder {
    const endsAt = new Date(auction.ends_at);
    const timeLeft = Math.max(0, endsAt.getTime() - Date.now());
    const minutesLeft = Math.floor(timeLeft / 60000);

    const embed = new EmbedBuilder()
        .setTitle(`🔨 Açık Artırma #${auction.id}`)
        .setDescription(`**${auction.name}** - ${auction.series}`)
        .setColor(0xF39C12)
        .addFields(
            { name: "Sıralama", value: `#${auction.rank}`, inline: true },
            { name: "Mevcut Teklif", value: `${auction.current_bid} SC`, inline: true },
            { name: "Kalan Süre", value: `${minutesLeft} dakika`, inline: true }
        )
        .setTimestamp();

    if (auction.image_url) {
        embed.setThumbnail(auction.image_url);
    }

    return embed;
}

// Takas embed'i
export function createTradeEmbed(trade: any, fromUsername: string): EmbedBuilder {
    let offerText = "";
    let requestText = "";

    if (trade.offer_char_name) {
        offerText += `🎴 ${trade.offer_char_name} (${trade.offer_char_series})\n`;
    }
    if (trade.offer_coins > 0) {
        offerText += `💰 ${trade.offer_coins} SC\n`;
    }

    if (trade.request_char_name) {
        requestText += `🎴 ${trade.request_char_name} (${trade.request_char_series})\n`;
    }
    if (trade.request_coins > 0) {
        requestText += `💰 ${trade.request_coins} SC\n`;
    }

    return new EmbedBuilder()
        .setTitle(`🔄 Takas Teklifi #${trade.id}`)
        .setDescription(`**${fromUsername}** tarafından gönderildi`)
        .setColor(0x9B59B6)
        .addFields(
            { name: "Teklif Edilen", value: offerText || "Yok", inline: true },
            { name: "İstenen", value: requestText || "Yok", inline: true }
        )
        .setFooter({ text: ".takaskabul veya .takasreddet kullanarak yanıtla" })
        .setTimestamp();
}

// Rehber embed'i - Oyunun nasıl oynandığını açıklar
export function createGuideEmbed(): EmbedBuilder {
    return new EmbedBuilder()
        .setTitle("📚 Türk Mudae Bot - Oyun Rehberi")
        .setColor(0x9B59B6)
        .setDescription("Hoş geldin! Bu rehber sana oyunun nasıl oynandığını öğretecek.")
        .addFields(
            {
                name: "🎮 Oyun Nedir?",
                value: `
Türk Mudae, anime ve oyun karakterlerini toplayabileceğin bir Discord botudur!
Karakterleri roll yaparak bulabilir, sahiplenebilir, takas edebilir ve açık artırmaya çıkarabilirsin.
                `.trim()
            },
            {
                name: "🎲 Karakter Nasıl Bulunur?",
                value: `
\`.roll\` veya \`.r\` yazarak rastgele bir karakter çağırabilirsin.
Özel roll komutları:
• \`.e\` - Sadece erkek karakterler
• \`.k\` - Sadece kadın karakterler
• \`.a\` - Sadece anime karakterleri
• \`.o\` - Sadece oyun karakterleri

⚠️ Saatte **10 roll hakkın** var! \`.ben\` ile kontrol edebilirsin.
                `.trim()
            },
            {
                name: "❤️ Karakter Nasıl Sahiplenilir?",
                value: `
Roll yaptığında altında ❤️ butonu çıkar. Bu butona tıklayarak karakteri sahiplenebilirsin!
• Her **3 saatte 1 claim hakkın** var
• Karakteri sahiplenmek için 60 saniye süren var
• Sahiplendiğin karakterleri \`.karakterlerim\` ile görebilirsin
                `.trim()
            },
            {
                name: "💰 Ekonomi Sistemi",
                value: `
• \`.gunluk\` - Her gün **100 ShoreCoin** al
• \`.bakiye\` - Bakiyeni kontrol et
• \`.transfer @kullanıcı miktar\` - Para gönder
• \`.özellik\` - Bonus claim/roll satın al
                `.trim()
            },
            {
                name: "🔄 Takas Sistemi",
                value: `
Diğer oyuncularla karakter takası yapabilirsin:
• \`.takas @kişi teklif_karakteri istek_karakteri\` - Takas teklifi
• \`.kosulsuztakas @kişi karakter\` - Hediye olarak gönder
• \`.takaskabul\` / \`.takasreddet\` - Takası yanıtla
                `.trim()
            },
            {
                name: "🔨 Açık Artırma",
                value: `
Karakterlerini ShoreCoin karşılığında satabilirsin:
• \`.satisacikar karakter_ismi fiyat dakika\` - Açık artırma başlat
• \`.teklif karakter_ismi miktar\` - Teklif ver
• \`.acikartirmalar\` - Aktif açık artırmaları gör
                `.trim()
            },
            {
                name: "📊 Karakter Değeri",
                value: `
Her karakterin bir sıralaması (rank) ve değeri var:
👑 #1 | 💎 Top 5 | 🔥 Top 10 | ⭐ Top 25 | ✨ Top 50 | 💫 Top 100
Düşük sıralama = Daha değerli karakter!
                `.trim()
            }
        )
        .setFooter({ text: "Tüm komutlar için: .yardim | Prefix: . (nokta)" })
        .setTimestamp();
}

// Yardım embed'i
export function createHelpEmbed(): EmbedBuilder {
    return new EmbedBuilder()
        .setTitle("📖 Türk Mudae Bot - Komutlar")
        .setColor(0x3498DB)
        .addFields(
            {
                name: "🎴 Karakter Komutları",
                value: `
\`.roll\` - Rastgele karakter
\`.e\` / \`.k\` - Erkek / Kadın
\`.ben\` - Durumunu gör
\`.karakterlerim\` - Karakterlerin
\`.karakterler\` - Tüm karakterler
\`.bütünkarakterlerisat\` - Tümünü sat
        `.trim()
            },
            {
                name: "💰 Ekonomi Komutları",
                value: `
\`.bakiye\` - Bakiyeni gör
\`.gunluk\` - Günlük ödül (100 SC)
\`.özellik\` - Bonus mağazası
\`.satınal <claim/roll>\` - Bonus satın al
        `.trim()
            },
            {
                name: "🔨 Açık Artırma Komutları",
                value: `
\`.satisacikar <karakter_ismi> [fiyat] [dakika]\` - Açık artırma başlat
\`.teklif <karakter_ismi> <miktar>\` - Teklif ver
\`.acikartirmalar\` - Aktif açık artırmaları listele
\`.acikartirmasil <karakter_ismi>\` - Açık artırmayı iptal et
        `.trim()
            },
            {
                name: "🔄 Takas Komutları",
                value: `
\`.takas @kullanıcı <teklif_ismi> <istek_ismi>\` - Takas teklif et
\`.kosulsuztakas @kullanıcı <karakter_ismi>\` - Karakter hediye et
\`.takaskabul <karakter_ismi>\` - Takası kabul et
\`.takasreddet <karakter_ismi>\` - Takası reddet
\`.takaslarim\` - Bekleyen takasları gör
        `.trim()
            },
            {
                name: "⬆️ Geliştirme Komutları",
                value: `
\`.gelistir <karakter_ismi>\` - Karakteri geliştir (Level başına 50 SC)
        `.trim()
            },
            {
                name: "📚 Rehber Komutları",
                value: `
\`.rehber\` - Oyunun nasıl oynandığını öğren
        `.trim()
            },
            {
                name: "🛠️ Admin Komutları",
                value: `
\`.karakterekle\` - Form ile karakter ekle
\`.resimekle <isim> <url>\` - Resim ekle
\`.sunucurestart\` - Sunucuyu sıfırla
        `.trim()
            }
        )
        .setFooter({ text: "Prefix: . (nokta)" })
        .setTimestamp();
}
