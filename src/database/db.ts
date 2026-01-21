import { Database } from "bun:sqlite";
import path from "path";

// Veritabanı yolu
const dbPath = path.join(import.meta.dir, "../../data/database.sqlite");

// Veritabanı bağlantısı
export const db = new Database(dbPath, { create: true });

// Tabloları oluştur
export function initializeDatabase() {
    // Characters tablosu - Tüm karakterler
    db.run(`
    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      series TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Anime',
      gender TEXT DEFAULT 'unknown',
      image_url TEXT,
      rank INTEGER NOT NULL DEFAULT 9999,
      value INTEGER NOT NULL DEFAULT 100,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

    // Gender kolonu için migration
    try {
        db.run(`ALTER TABLE characters ADD COLUMN gender TEXT DEFAULT 'unknown'`);
    } catch (e) {
        // Kolon zaten varsa ignore
    }

    // Users tablosu - Kullanıcılar
    db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT UNIQUE NOT NULL,
      shorecoins INTEGER DEFAULT 0,
      daily_claimed_at DATETIME,
      roll_count INTEGER DEFAULT 0,
      roll_reset_at DATETIME,
      claim_cooldown_at DATETIME,
      bonus_claims INTEGER DEFAULT 0,
      bonus_rolls INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

    // Migration - yeni alanlar (her biri ayrı try-catch)
    try { db.run(`ALTER TABLE users ADD COLUMN roll_count INTEGER DEFAULT 0`); } catch (e) { }
    try { db.run(`ALTER TABLE users ADD COLUMN roll_reset_at DATETIME`); } catch (e) { }
    try { db.run(`ALTER TABLE users ADD COLUMN claim_cooldown_at DATETIME`); } catch (e) { }
    try { db.run(`ALTER TABLE users ADD COLUMN bonus_claims INTEGER DEFAULT 0`); } catch (e) { }
    try { db.run(`ALTER TABLE users ADD COLUMN bonus_rolls INTEGER DEFAULT 0`); } catch (e) { }


    // User Characters tablosu - Kullanıcıların sahip olduğu karakterler
    db.run(`
    CREATE TABLE IF NOT EXISTS user_characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      level INTEGER DEFAULT 1,
      acquired_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (character_id) REFERENCES characters(id)
    )
  `);

    // Auctions tablosu - Açık artırmalar
    db.run(`
    CREATE TABLE IF NOT EXISTS auctions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller_id INTEGER NOT NULL,
      user_character_id INTEGER NOT NULL,
      channel_id TEXT,
      starting_price INTEGER NOT NULL,
      current_bid INTEGER NOT NULL,
      highest_bidder_id INTEGER,
      ends_at DATETIME NOT NULL,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (seller_id) REFERENCES users(id),
      FOREIGN KEY (user_character_id) REFERENCES user_characters(id),
      FOREIGN KEY (highest_bidder_id) REFERENCES users(id)
    )
  `);

    // Migration - auctions tablosuna channel_id ekleme
    try { db.run(`ALTER TABLE auctions ADD COLUMN channel_id TEXT`); } catch (e) { }

    // Auction Bids tablosu - Açık artırma teklifleri
    db.run(`
    CREATE TABLE IF NOT EXISTS auction_bids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      auction_id INTEGER NOT NULL,
      bidder_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (auction_id) REFERENCES auctions(id),
      FOREIGN KEY (bidder_id) REFERENCES users(id)
    )
  `);

    // Trades tablosu - Takas istekleri
    db.run(`
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_user_id INTEGER NOT NULL,
      to_user_id INTEGER NOT NULL,
      offer_character_id INTEGER,
      offer_coins INTEGER DEFAULT 0,
      request_character_id INTEGER,
      request_coins INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (from_user_id) REFERENCES users(id),
      FOREIGN KEY (to_user_id) REFERENCES users(id),
      FOREIGN KEY (offer_character_id) REFERENCES user_characters(id),
      FOREIGN KEY (request_character_id) REFERENCES user_characters(id)
    )
  `);

    // Character Images tablosu - Karakter resimleri
    db.run(`
    CREATE TABLE IF NOT EXISTS character_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL,
      image_url TEXT NOT NULL,
      is_local INTEGER DEFAULT 0,
      image_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (character_id) REFERENCES characters(id)
    )
  `);

    console.log("✅ Veritabanı başarıyla oluşturuldu!");
}

// Kullanıcı işlemleri
export function getOrCreateUser(discordId: string) {
    let user = db.query("SELECT * FROM users WHERE discord_id = ?").get(discordId);

    if (!user) {
        db.run("INSERT INTO users (discord_id, shorecoins) VALUES (?, 0)", [discordId]);
        user = db.query("SELECT * FROM users WHERE discord_id = ?").get(discordId);
    }

    return user;
}

export function updateUserCoins(discordId: string, amount: number) {
    db.run("UPDATE users SET shorecoins = shorecoins + ? WHERE discord_id = ?", [amount, discordId]);
}

export function setUserCoins(discordId: string, amount: number) {
    db.run("UPDATE users SET shorecoins = ? WHERE discord_id = ?", [amount, discordId]);
}

export function claimDaily(discordId: string) {
    const user = getOrCreateUser(discordId) as any;
    const now = new Date();
    const lastClaim = user.daily_claimed_at ? new Date(user.daily_claimed_at) : null;

    // Günlük sıfırlanma kontrolü (24 saat)
    if (lastClaim) {
        const timeDiff = now.getTime() - lastClaim.getTime();
        const hoursDiff = timeDiff / (1000 * 60 * 60);

        if (hoursDiff < 24) {
            const remaining = 24 - hoursDiff;
            const hours = Math.floor(remaining);
            const minutes = Math.floor((remaining - hours) * 60);
            return { success: false, message: `⏰ Günlük ödülünü almak için ${hours} saat ${minutes} dakika beklemelisin!` };
        }
    }

    // Günlük ödül miktarı
    const dailyReward = 100;

    db.run(
        "UPDATE users SET shorecoins = shorecoins + ?, daily_claimed_at = ? WHERE discord_id = ?",
        [dailyReward, now.toISOString(), discordId]
    );

    return { success: true, amount: dailyReward };
}

// Karakter işlemleri
export function addCharacter(name: string, series: string, category: string, imageUrl: string, rank: number) {
    // Rank'a göre rastgele değer hesapla (düşük rank = yüksek değer)
    let minValue: number, maxValue: number;
    if (rank === 1) {
        minValue = 5000; maxValue = 10000;
    } else if (rank <= 5) {
        minValue = 2000; maxValue = 5000;
    } else if (rank <= 10) {
        minValue = 1000; maxValue = 2500;
    } else if (rank <= 25) {
        minValue = 500; maxValue = 1200;
    } else if (rank <= 50) {
        minValue = 250; maxValue = 600;
    } else if (rank <= 100) {
        minValue = 100; maxValue = 300;
    } else {
        minValue = 50; maxValue = 150;
    }
    const value = Math.floor(Math.random() * (maxValue - minValue + 1)) + minValue;

    db.run(
        "INSERT INTO characters (name, series, category, image_url, rank, value) VALUES (?, ?, ?, ?, ?, ?)",
        [name, series, category, imageUrl, rank, value]
    );
    return db.query("SELECT * FROM characters WHERE name = ? AND series = ?").get(name, series);
}

export function getRandomCharacter(filter?: { gender?: string; category?: string }) {
    // Filtreleme parametreleri
    let whereClause = "WHERE c.id NOT IN (SELECT character_id FROM user_characters)";
    const params: any[] = [];

    if (filter?.gender) {
        whereClause += " AND c.gender = ?";
        params.push(filter.gender);
    }

    if (filter?.category) {
        whereClause += " AND c.category = ?";
        params.push(filter.category);
    }

    return db.query(`
        SELECT c.* FROM characters c
        ${whereClause}
        ORDER BY RANDOM() 
        LIMIT 1
    `).get(...params);
}

export function getAllCharacters() {
    return db.query("SELECT * FROM characters ORDER BY rank ASC").all();
}

export function getCharacterById(id: number) {
    return db.query("SELECT * FROM characters WHERE id = ?").get(id);
}

export function getCharacterByName(name: string) {
    // İsimle ara (case-insensitive, LIKE ile)
    return db.query(`
        SELECT c.*, uc.id as user_char_id, u.discord_id as owner_discord_id
        FROM characters c
        LEFT JOIN user_characters uc ON c.id = uc.character_id
        LEFT JOIN users u ON uc.user_id = u.id
        WHERE LOWER(c.name) LIKE LOWER(?)
        LIMIT 1
    `).get(`%${name}%`);
}

// Kullanıcı karakter işlemleri
export function giveCharacterToUser(userId: number, characterId: number) {
    db.run(
        "INSERT INTO user_characters (user_id, character_id) VALUES (?, ?)",
        [userId, characterId]
    );
}

export function getUserCharacters(discordId: string) {
    return db.query(`
    SELECT uc.*, c.name, c.series, c.category, c.image_url, c.rank, c.value 
    FROM user_characters uc
    JOIN characters c ON uc.character_id = c.id
    JOIN users u ON uc.user_id = u.id
    WHERE u.discord_id = ?
    ORDER BY c.rank ASC
  `).all(discordId);
}

export function getUserCharacterById(userCharacterId: number) {
    return db.query(`
    SELECT uc.*, c.name, c.series, c.category, c.image_url, c.rank, u.discord_id
    FROM user_characters uc
    JOIN characters c ON uc.character_id = c.id
    JOIN users u ON uc.user_id = u.id
    WHERE uc.id = ?
  `).get(userCharacterId);
}

export function getUserCharacterByName(discordId: string, characterName: string) {
    // Kullanıcının sahip olduğu karakteri isimle bul
    return db.query(`
    SELECT uc.*, c.name, c.series, c.category, c.image_url, c.rank, c.value, u.discord_id
    FROM user_characters uc
    JOIN characters c ON uc.character_id = c.id
    JOIN users u ON uc.user_id = u.id
    WHERE u.discord_id = ? AND LOWER(c.name) LIKE LOWER(?)
    LIMIT 1
  `).get(discordId, `%${characterName}%`);
}

// Karakter satış işlemi
export function sellCharacter(discordId: string, characterName: string) {
    const userChar = getUserCharacterByName(discordId, characterName) as any;

    if (!userChar) {
        return { success: false, message: `❌ "${characterName}" isimli bir karakterin yok!` };
    }

    const sellValue = userChar.value || 100; // Varsayılan değer 100 SC

    // Kullanıcıya parayı ver
    updateUserCoins(discordId, sellValue);

    // Karakteri envanterden kaldır
    removeUserCharacter(userChar.id);

    return {
        success: true,
        characterName: userChar.name,
        series: userChar.series,
        value: sellValue
    };
}

export function removeUserCharacter(userCharacterId: number) {
    db.run("DELETE FROM user_characters WHERE id = ?", [userCharacterId]);
}

export function upgradeCharacter(userCharacterId: number, cost: number, discordId: string) {
    const user = getOrCreateUser(discordId) as any;

    if (user.shorecoins < cost) {
        return { success: false, message: "❌ Yeterli ShoreCoin'in yok!" };
    }

    // Kullanıcıdan parayı al
    db.run("UPDATE users SET shorecoins = shorecoins - ? WHERE discord_id = ?", [cost, discordId]);

    // Karakteri geliştir (level +1)
    db.run("UPDATE user_characters SET level = level + 1 WHERE id = ?", [userCharacterId]);

    // Karakter değerini artır (harcanan paranın %20'si kadar)
    const valueIncrease = Math.floor(cost * 0.20);
    const userChar = getUserCharacterById(userCharacterId) as any;
    if (userChar) {
        db.run("UPDATE characters SET value = value + ? WHERE id = ?", [valueIncrease, userChar.character_id]);
    }

    return { success: true, valueIncrease };
}

// Açık artırma işlemleri
export function createAuction(sellerId: number, userCharacterId: number, startingPrice: number, durationMinutes: number, channelId?: string) {
    const endsAt = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();

    db.run(
        "INSERT INTO auctions (seller_id, user_character_id, starting_price, current_bid, ends_at, channel_id) VALUES (?, ?, ?, ?, ?, ?)",
        [sellerId, userCharacterId, startingPrice, startingPrice, endsAt, channelId || null]
    );

    // Son eklenen satırı al
    return db.query("SELECT * FROM auctions WHERE id = last_insert_rowid()").get();
}

export function getActiveAuctions() {
    return db.query(`
    SELECT a.*, c.name, c.series, c.image_url, c.rank, u.discord_id as seller_discord_id
    FROM auctions a
    JOIN user_characters uc ON a.user_character_id = uc.id
    JOIN characters c ON uc.character_id = c.id
    JOIN users u ON a.seller_id = u.id
    WHERE a.status = 'active' AND a.ends_at > datetime('now')
    ORDER BY a.ends_at ASC
  `).all();
}

// Süresi dolmuş aktif açık artırmaları getir
export function getExpiredAuctions() {
    return db.query(`
    SELECT a.*, c.name, c.series, c.image_url, c.rank, u.discord_id as seller_discord_id
    FROM auctions a
    JOIN user_characters uc ON a.user_character_id = uc.id
    JOIN characters c ON uc.character_id = c.id
    JOIN users u ON a.seller_id = u.id
    WHERE a.status = 'active' AND a.ends_at <= datetime('now')
    ORDER BY a.ends_at ASC
  `).all();
}

export function getAuctionByCharacterName(characterName: string) {
    return db.query(`
    SELECT a.*, c.name, c.series, c.image_url, c.rank, uc.user_id as original_owner_id
    FROM auctions a
    JOIN user_characters uc ON a.user_character_id = uc.id
    JOIN characters c ON uc.character_id = c.id
    WHERE a.status = 'active' AND a.ends_at > datetime('now') AND LOWER(c.name) LIKE LOWER(?)
    LIMIT 1
  `).get(`%${characterName}%`);
}

export function getAuctionById(auctionId: number) {
    return db.query(`
    SELECT a.*, c.name, c.series, c.image_url, c.rank, uc.user_id as original_owner_id
    FROM auctions a
    JOIN user_characters uc ON a.user_character_id = uc.id
    JOIN characters c ON uc.character_id = c.id
    WHERE a.id = ?
  `).get(auctionId);
}

export function placeBid(auctionId: number, bidderId: number, amount: number) {
    const auction = getAuctionById(auctionId) as any;

    if (!auction) {
        return { success: false, message: "❌ Açık artırma bulunamadı!" };
    }

    if (auction.status !== 'active') {
        return { success: false, message: "❌ Bu açık artırma artık aktif değil!" };
    }

    if (new Date(auction.ends_at) < new Date()) {
        return { success: false, message: "❌ Bu açık artırma sona erdi!" };
    }

    if (amount <= auction.current_bid) {
        return { success: false, message: `❌ Teklifin mevcut tekliften (${auction.current_bid} SC) yüksek olmalı!` };
    }

    // Eski en yüksek teklif sahibine parasını iade et
    if (auction.highest_bidder_id) {
        const oldBidder = db.query("SELECT discord_id FROM users WHERE id = ?").get(auction.highest_bidder_id) as any;
        if (oldBidder) {
            updateUserCoins(oldBidder.discord_id, auction.current_bid);
        }
    }

    // Yeni teklif sahibinden parayı al
    const bidder = db.query("SELECT * FROM users WHERE id = ?").get(bidderId) as any;
    if (bidder.shorecoins < amount) {
        return { success: false, message: "❌ Yeterli ShoreCoin'in yok!" };
    }

    db.run("UPDATE users SET shorecoins = shorecoins - ? WHERE id = ?", [amount, bidderId]);

    // Teklifi kaydet
    db.run("INSERT INTO auction_bids (auction_id, bidder_id, amount) VALUES (?, ?, ?)", [auctionId, bidderId, amount]);
    db.run("UPDATE auctions SET current_bid = ?, highest_bidder_id = ? WHERE id = ?", [amount, bidderId, auctionId]);

    return { success: true, amount };
}

export function completeAuction(auctionId: number) {
    const auction = getAuctionById(auctionId) as any;

    if (!auction || auction.status !== 'active') {
        return { success: false };
    }

    if (auction.highest_bidder_id) {
        // Karakteri kazanana transfer et
        db.run("UPDATE user_characters SET user_id = ? WHERE id = ?", [auction.highest_bidder_id, auction.user_character_id]);

        // Satıcıya parayı ver
        const seller = db.query("SELECT discord_id FROM users WHERE id = ?").get(auction.original_owner_id) as any;
        if (seller) {
            updateUserCoins(seller.discord_id, auction.current_bid);
        }
    }

    db.run("UPDATE auctions SET status = 'completed' WHERE id = ?", [auctionId]);

    return { success: true, winnerId: auction.highest_bidder_id };
}

// Takas işlemleri
export function createTrade(
    fromUserId: number,
    toUserId: number,
    offerCharacterId: number | null,
    offerCoins: number,
    requestCharacterId: number | null,
    requestCoins: number
) {
    db.run(
        `INSERT INTO trades (from_user_id, to_user_id, offer_character_id, offer_coins, request_character_id, request_coins)
     VALUES (?, ?, ?, ?, ?, ?)`,
        [fromUserId, toUserId, offerCharacterId, offerCoins, requestCharacterId, requestCoins]
    );

    return db.query("SELECT * FROM trades WHERE from_user_id = ? ORDER BY id DESC LIMIT 1").get(fromUserId);
}

export function getPendingTrades(discordId: string) {
    const user = getOrCreateUser(discordId) as any;

    return db.query(`
    SELECT t.*, 
           oc.name as offer_char_name, oc.series as offer_char_series,
           rc.name as request_char_name, rc.series as request_char_series,
           fu.discord_id as from_discord_id
    FROM trades t
    LEFT JOIN user_characters ouc ON t.offer_character_id = ouc.id
    LEFT JOIN characters oc ON ouc.character_id = oc.id
    LEFT JOIN user_characters ruc ON t.request_character_id = ruc.id
    LEFT JOIN characters rc ON ruc.character_id = rc.id
    JOIN users fu ON t.from_user_id = fu.id
    WHERE t.to_user_id = ? AND t.status = 'pending'
  `).all(user.id);
}

export function acceptTrade(tradeId: number) {
    const trade = db.query("SELECT * FROM trades WHERE id = ?").get(tradeId) as any;

    if (!trade || trade.status !== 'pending') {
        return { success: false, message: "❌ Takas bulunamadı veya artık geçerli değil!" };
    }

    // Karakter transferleri
    if (trade.offer_character_id) {
        db.run("UPDATE user_characters SET user_id = ? WHERE id = ?", [trade.to_user_id, trade.offer_character_id]);
    }

    if (trade.request_character_id) {
        db.run("UPDATE user_characters SET user_id = ? WHERE id = ?", [trade.from_user_id, trade.request_character_id]);
    }

    // Coin transferleri
    if (trade.offer_coins > 0) {
        const fromUser = db.query("SELECT discord_id FROM users WHERE id = ?").get(trade.from_user_id) as any;
        const toUser = db.query("SELECT discord_id FROM users WHERE id = ?").get(trade.to_user_id) as any;
        updateUserCoins(fromUser.discord_id, -trade.offer_coins);
        updateUserCoins(toUser.discord_id, trade.offer_coins);
    }

    if (trade.request_coins > 0) {
        const fromUser = db.query("SELECT discord_id FROM users WHERE id = ?").get(trade.from_user_id) as any;
        const toUser = db.query("SELECT discord_id FROM users WHERE id = ?").get(trade.to_user_id) as any;
        updateUserCoins(toUser.discord_id, -trade.request_coins);
        updateUserCoins(fromUser.discord_id, trade.request_coins);
    }

    db.run("UPDATE trades SET status = 'accepted' WHERE id = ?", [tradeId]);

    return { success: true };
}

export function rejectTrade(tradeId: number) {
    db.run("UPDATE trades SET status = 'rejected' WHERE id = ?", [tradeId]);
    return { success: true };
}

// Açık artırma silme
export function deleteAuction(auctionId: number, discordId: string) {
    const auction = db.query(`
        SELECT a.*, u.discord_id as seller_discord_id
        FROM auctions a
        JOIN users u ON a.seller_id = u.id
        WHERE a.id = ?
    `).get(auctionId) as any;

    if (!auction) {
        return { success: false, message: "❌ Bu açık artırma bulunamadı!" };
    }

    if (auction.seller_discord_id !== discordId) {
        return { success: false, message: "❌ Bu açık artırma sana ait değil!" };
    }

    if (auction.status !== 'active') {
        return { success: false, message: "❌ Bu açık artırma artık aktif değil!" };
    }

    // En yüksek teklif sahibine parasını iade et
    if (auction.highest_bidder_id) {
        const bidder = db.query("SELECT discord_id FROM users WHERE id = ?").get(auction.highest_bidder_id) as any;
        if (bidder) {
            updateUserCoins(bidder.discord_id, auction.current_bid);
        }
    }

    db.run("UPDATE auctions SET status = 'cancelled' WHERE id = ?", [auctionId]);
    return { success: true };
}

// Karakter ismiyle takas bul
export function getTradeByCharacterName(discordId: string, characterName: string) {
    const user = getOrCreateUser(discordId) as any;

    return db.query(`
        SELECT t.*, 
               oc.name as offer_char_name, oc.series as offer_char_series,
               rc.name as request_char_name, rc.series as request_char_series,
               fu.discord_id as from_discord_id
        FROM trades t
        LEFT JOIN user_characters ouc ON t.offer_character_id = ouc.id
        LEFT JOIN characters oc ON ouc.character_id = oc.id
        LEFT JOIN user_characters ruc ON t.request_character_id = ruc.id
        LEFT JOIN characters rc ON ruc.character_id = rc.id
        JOIN users fu ON t.from_user_id = fu.id
        WHERE t.to_user_id = ? AND t.status = 'pending' 
        AND (LOWER(oc.name) LIKE LOWER(?) OR LOWER(rc.name) LIKE LOWER(?))
        LIMIT 1
    `).get(user.id, `%${characterName}%`, `%${characterName}%`);
}

// ==================== KARAKTER RESİM İŞLEMLERİ ====================

// Karaktere resim ekle
export function addCharacterImage(characterId: number, imageUrl: string, isLocal: boolean = false) {
    // Mevcut en yüksek order'ı bul
    const maxOrder = db.query(
        "SELECT MAX(image_order) as max_order FROM character_images WHERE character_id = ?"
    ).get(characterId) as any;
    const newOrder = (maxOrder?.max_order || 0) + 1;

    db.run(
        "INSERT INTO character_images (character_id, image_url, is_local, image_order) VALUES (?, ?, ?, ?)",
        [characterId, imageUrl, isLocal ? 1 : 0, newOrder]
    );

    return db.query("SELECT * FROM character_images WHERE character_id = ? ORDER BY id DESC LIMIT 1").get(characterId);
}

// Karakterin tüm resimlerini getir
export function getCharacterImages(characterId: number) {
    return db.query(
        "SELECT * FROM character_images WHERE character_id = ? ORDER BY image_order ASC"
    ).all(characterId);
}

// Karakter isminden ID bul ve resimleri getir
export function getCharacterImagesByName(characterName: string) {
    const character = getCharacterByName(characterName) as any;
    if (!character) return [];
    return getCharacterImages(character.id);
}

// Resim sil
export function removeCharacterImage(imageId: number) {
    db.run("DELETE FROM character_images WHERE id = ?", [imageId]);
    return { success: true };
}

// Karakterin rastgele bir resmini getir
export function getRandomCharacterImage(characterId: number) {
    const images = getCharacterImages(characterId) as any[];
    if (images.length === 0) return null;
    return images[Math.floor(Math.random() * images.length)];
}

// Karakter ID'sine göre tüm resimleri sil
export function removeAllCharacterImages(characterId: number) {
    db.run("DELETE FROM character_images WHERE character_id = ?", [characterId]);
    return { success: true };
}

// ==================== ROLL LİMİT SİSTEMİ ====================

const ROLL_LIMIT = 10; // Saat başına maksimum roll
const ROLL_RESET_HOURS = 1; // Kaç saat sonra reset

// Roll yapılabilir mi kontrolü (bonus roll dahil)
export function canRoll(discordId: string): { canRoll: boolean; remaining: number; resetAt: Date | null; usingBonus: boolean } {
    const user = getOrCreateUser(discordId) as any;

    const now = new Date();
    const resetAt = user.roll_reset_at ? new Date(user.roll_reset_at) : null;

    // Reset zamanı geçtiyse veya hiç ayarlanmamışsa, sıfırla
    if (!resetAt || now > resetAt) {
        db.run("UPDATE users SET roll_count = 0, roll_reset_at = NULL WHERE discord_id = ?", [discordId]);
        return { canRoll: true, remaining: ROLL_LIMIT, resetAt: null, usingBonus: false };
    }

    const rollCount = user.roll_count || 0;
    const remaining = ROLL_LIMIT - rollCount;
    const bonusRolls = user.bonus_rolls || 0;

    // Normal roll hakkı varsa
    if (remaining > 0) {
        return {
            canRoll: true,
            remaining: Math.max(0, remaining),
            resetAt,
            usingBonus: false
        };
    }

    // Normal roll hakkı yoksa bonus var mı kontrol et
    if (bonusRolls > 0) {
        return {
            canRoll: true,
            remaining: 0,
            resetAt,
            usingBonus: true
        };
    }

    return {
        canRoll: false,
        remaining: 0,
        resetAt,
        usingBonus: false
    };
}

// Roll sayacını artır
export function incrementRollCount(discordId: string): { remaining: number; resetAt: Date } {
    const user = getOrCreateUser(discordId) as any;

    const now = new Date();
    let resetAt = user.roll_reset_at ? new Date(user.roll_reset_at) : null;
    let rollCount = user.roll_count || 0;

    // Reset zamanı geçtiyse veya hiç ayarlanmamışsa
    if (!resetAt || now > resetAt) {
        rollCount = 0;
        resetAt = new Date(now.getTime() + ROLL_RESET_HOURS * 60 * 60 * 1000);
    }

    rollCount++;

    db.run(
        "UPDATE users SET roll_count = ?, roll_reset_at = ? WHERE discord_id = ?",
        [rollCount, resetAt.toISOString(), discordId]
    );

    return { remaining: ROLL_LIMIT - rollCount, resetAt };
}

// Kullanıcı bilgilerini getir (.ben komutu için)
export function getUserInfo(discordId: string) {
    const user = getOrCreateUser(discordId) as any;
    const characters = getUserCharacters(discordId) as any[];

    const now = new Date();
    const rollResetAt = user.roll_reset_at ? new Date(user.roll_reset_at) : null;
    const dailyClaimedAt = user.daily_claimed_at ? new Date(user.daily_claimed_at) : null;

    // Roll durumu
    let rollRemaining = ROLL_LIMIT;
    let rollResetTime: Date | null = null;

    if (rollResetAt && now < rollResetAt) {
        rollRemaining = ROLL_LIMIT - (user.roll_count || 0);
        rollResetTime = rollResetAt;
    }

    // Daily durumu
    let canClaimDaily = true;
    let dailyResetTime: Date | null = null;

    if (dailyClaimedAt) {
        const tomorrow = new Date(dailyClaimedAt);
        tomorrow.setHours(tomorrow.getHours() + 24);

        if (now < tomorrow) {
            canClaimDaily = false;
            dailyResetTime = tomorrow;
        }
    }

    // Claim cooldown durumu
    const claimCooldownAt = user.claim_cooldown_at ? new Date(user.claim_cooldown_at) : null;
    let canClaim = true;
    let claimResetTime: Date | null = null;

    if (claimCooldownAt && now < claimCooldownAt) {
        canClaim = false;
        claimResetTime = claimCooldownAt;
    }

    return {
        shorecoins: user.shorecoins || 0,
        characterCount: characters.length,
        rollRemaining: Math.max(0, rollRemaining),
        rollResetTime,
        canClaimDaily,
        dailyResetTime,
        canClaim,
        claimResetTime,
        bonusClaims: user.bonus_claims || 0,
        bonusRolls: user.bonus_rolls || 0
    };
}

// ==================== CLAIM COOLDOWN SİSTEMİ ====================

const CLAIM_COOLDOWN_HOURS = 2; // 2 saat cooldown

// Claim yapılabilir mi kontrolü (bonus claim dahil)
export function canClaimCharacter(discordId: string): { canClaim: boolean; resetAt: Date | null; usingBonus: boolean } {
    const user = getOrCreateUser(discordId) as any;
    const now = new Date();
    const cooldownAt = user.claim_cooldown_at ? new Date(user.claim_cooldown_at) : null;
    const bonusClaims = user.bonus_claims || 0;

    // Cooldown süresi geçtiyse veya hiç ayarlanmamışsa
    if (!cooldownAt || now > cooldownAt) {
        return { canClaim: true, resetAt: null, usingBonus: false };
    }

    // Cooldown varsa bonus claim kontrol et
    if (bonusClaims > 0) {
        return { canClaim: true, resetAt: cooldownAt, usingBonus: true };
    }

    return { canClaim: false, resetAt: cooldownAt, usingBonus: false };
}

// Claim cooldown'ı ayarla
export function setClaimCooldown(discordId: string): Date {
    const now = new Date();
    const cooldownEnd = new Date(now.getTime() + CLAIM_COOLDOWN_HOURS * 60 * 60 * 1000);

    db.run(
        "UPDATE users SET claim_cooldown_at = ? WHERE discord_id = ?",
        [cooldownEnd.toISOString(), discordId]
    );

    return cooldownEnd;
}

// ==================== ÖZELLİK SİSTEMİ ====================

// Bonus claim ekle
export function addBonusClaim(discordId: string, amount: number = 1) {
    getOrCreateUser(discordId);
    db.run(
        "UPDATE users SET bonus_claims = bonus_claims + ? WHERE discord_id = ?",
        [amount, discordId]
    );
}

// Bonus roll ekle
export function addBonusRoll(discordId: string, amount: number = 1) {
    getOrCreateUser(discordId);
    db.run(
        "UPDATE users SET bonus_rolls = bonus_rolls + ? WHERE discord_id = ?",
        [amount, discordId]
    );
}

// Bonus claim kullan
export function useBonusClaim(discordId: string): boolean {
    const user = getOrCreateUser(discordId) as any;
    if ((user.bonus_claims || 0) > 0) {
        db.run(
            "UPDATE users SET bonus_claims = bonus_claims - 1 WHERE discord_id = ?",
            [discordId]
        );
        return true;
    }
    return false;
}

// Bonus roll kullan
export function useBonusRoll(discordId: string): boolean {
    const user = getOrCreateUser(discordId) as any;
    if ((user.bonus_rolls || 0) > 0) {
        db.run(
            "UPDATE users SET bonus_rolls = bonus_rolls - 1 WHERE discord_id = ?",
            [discordId]
        );
        return true;
    }
    return false;
}

// Sayfalama için karakter listesi
export function getCharactersPaginated(page: number = 1, perPage: number = 15) {
    const offset = (page - 1) * perPage;
    const characters = db.query(`
        SELECT * FROM characters 
        ORDER BY rank ASC 
        LIMIT ? OFFSET ?
    `).all(perPage, offset) as any[];

    const totalResult = db.query("SELECT COUNT(*) as count FROM characters").get() as any;
    const total = totalResult?.count || 0;
    const totalPages = Math.ceil(total / perPage);

    return { characters, page, totalPages, total };
}

// Karakter ismini değiştir
export function renameCharacter(oldName: string, newName: string): { success: boolean; message?: string; character?: any } {
    // Eski isimle karakteri bul
    const character = db.query(`
        SELECT * FROM characters 
        WHERE LOWER(name) LIKE LOWER(?)
        LIMIT 1
    `).get(`%${oldName}%`) as any;

    if (!character) {
        return { success: false, message: `❌ "${oldName}" isimli karakter bulunamadı!` };
    }

    // Yeni ismin zaten kullanılıp kullanılmadığını kontrol et
    const existing = db.query(`
        SELECT * FROM characters 
        WHERE LOWER(name) = LOWER(?) AND id != ?
        LIMIT 1
    `).get(newName, character.id) as any;

    if (existing) {
        return { success: false, message: `❌ "${newName}" isimli bir karakter zaten var!` };
    }

    // İsmi güncelle
    db.run("UPDATE characters SET name = ? WHERE id = ?", [newName, character.id]);

    return {
        success: true,
        character: { ...character, name: newName }
    };
}

