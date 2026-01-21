// Tüm Animelerin Karakterlerini Çekme Scripti
// AniList API'den tüm animeleri ve karakterlerini çeker
// Kullanım: bun run src/fetchAllAnimeCharacters.ts --max-anime 500
//
// Bu script ÇALIŞMASI UZUN SÜRER - binlerce anime ve onbinlerce karakter var!
// Rate limit: AniList 90 req/dakika

import { db, initializeDatabase } from "./database/db";
import { calculateValueFromFavorites } from "./utils/jikanApi";

const ANILIST_API_URL = "https://graphql.anilist.co";
const RATE_LIMIT_DELAY = 700; // 0.7 saniye

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Argümanları parse et
function parseArgs(): { maxAnime: number; startPage: number } {
    const args = process.argv.slice(2);
    let maxAnime = 500; // Varsayılan: 500 anime
    let startPage = 1;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--max-anime" && args[i + 1]) {
            maxAnime = parseInt(args[i + 1]) || 500;
        }
        if (args[i] === "--start-page" && args[i + 1]) {
            startPage = parseInt(args[i + 1]) || 1;
        }
    }

    return { maxAnime, startPage };
}

// AniList'ten anime listesi çek (tüm animeler, popülerlik sırası yok)
async function fetchAnimeList(page: number): Promise<any[]> {
    const query = `
        query ($page: Int, $perPage: Int) {
            Page(page: $page, perPage: $perPage) {
                pageInfo {
                    hasNextPage
                    total
                }
                media(type: ANIME, sort: TITLE_ROMAJI) {
                    id
                    title {
                        romaji
                        english
                    }
                    popularity
                }
            }
        }
    `;

    try {
        await delay(RATE_LIMIT_DELAY);
        const response = await fetch(ANILIST_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            body: JSON.stringify({
                query,
                variables: { page, perPage: 50 }
            })
        });

        const data = await response.json();
        return data.data?.Page?.media || [];
    } catch (error) {
        console.error(`Anime listesi çekilemedi (sayfa ${page}):`, error);
        return [];
    }
}

// Bir anime'nin tüm karakterlerini çek
async function fetchAnimeCharacters(animeId: number, animeName: string): Promise<any[]> {
    const query = `
        query ($id: Int, $page: Int) {
            Media(id: $id, type: ANIME) {
                characters(page: $page, perPage: 25, sort: FAVOURITES_DESC) {
                    pageInfo {
                        hasNextPage
                    }
                    edges {
                        role
                        node {
                            id
                            name {
                                full
                            }
                            image {
                                large
                            }
                            favourites
                            gender
                        }
                    }
                }
            }
        }
    `;

    const allCharacters: any[] = [];
    let page = 1;
    let hasNextPage = true;

    while (hasNextPage) {
        try {
            await delay(RATE_LIMIT_DELAY);
            const response = await fetch(ANILIST_API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                body: JSON.stringify({
                    query,
                    variables: { id: animeId, page }
                })
            });

            const data = await response.json();
            const characters = data.data?.Media?.characters;

            if (!characters || !characters.edges || characters.edges.length === 0) {
                break;
            }

            for (const edge of characters.edges) {
                if (edge.node) {
                    allCharacters.push({
                        ...edge.node,
                        role: edge.role,
                        animeName
                    });
                }
            }

            hasNextPage = characters.pageInfo?.hasNextPage || false;
            page++;

            // Maksimum 5 sayfa karakterler (125 karakter per anime)
            if (page > 5) break;

        } catch (error) {
            console.error(`  Karakter çekilemedi (${animeName}):`, error);
            break;
        }
    }

    return allCharacters;
}

// Karakter ekle veya güncelle
function upsertCharacter(
    name: string,
    series: string,
    imageUrl: string,
    favorites: number,
    gender: string = "unknown"
): { action: "added" | "updated" | "skipped"; id?: number } {
    const value = calculateValueFromFavorites(favorites);

    // Gender'ı dönüştür
    let genderValue = "unknown";
    if (gender === "Male") genderValue = "male";
    else if (gender === "Female") genderValue = "female";

    // Mevcut karakteri kontrol et
    const existing = db.query(
        "SELECT id, value FROM characters WHERE LOWER(name) = LOWER(?) AND LOWER(series) = LOWER(?)"
    ).get(name, series) as any;

    if (existing) {
        // Sadece resim güncellemesi yap (değeri korumak için)
        if (imageUrl) {
            db.run(
                "UPDATE characters SET image_url = ? WHERE id = ?",
                [imageUrl, existing.id]
            );
        }
        return { action: "skipped", id: existing.id };
    }

    // Yeni karakter ekle
    db.run(
        "INSERT INTO characters (name, series, category, image_url, rank, value, gender) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [name, series, "Anime", imageUrl, 9999, value, genderValue]
    );

    const newChar = db.query(
        "SELECT id FROM characters WHERE LOWER(name) = LOWER(?) AND LOWER(series) = LOWER(?)"
    ).get(name, series) as any;

    return { action: "added", id: newChar?.id };
}

// Tüm karakterlere değerlerine göre benzersiz rank ata
function assignUniqueRanks(): number {
    console.log("\n🔄 Benzersiz rank ataması yapılıyor...");

    const characters = db.query(`
        SELECT id, name, value 
        FROM characters 
        ORDER BY value DESC, id ASC
    `).all() as any[];

    for (let i = 0; i < characters.length; i++) {
        const newRank = i + 1;
        db.run("UPDATE characters SET rank = ? WHERE id = ?", [newRank, characters[i].id]);
    }

    console.log(`   ✅ ${characters.length} karaktere benzersiz rank atandı (1-${characters.length})`);
    return characters.length;
}

// Ana fonksiyon
async function fetchAllAnimeCharacters() {
    console.log("🚀 TÜM ANİME KARAKTERLERİ ÇEKİLİYOR...\n");
    console.log("⚠️  Bu işlem UZUN SÜRECEK! Binlerce anime ve onbinlerce karakter var.\n");

    // Veritabanını başlat
    initializeDatabase();

    const { maxAnime, startPage } = parseArgs();
    console.log(`📋 Ayarlar: Maksimum ${maxAnime} anime, ${startPage}. sayfadan başla`);

    let totalAnime = 0;
    let totalAdded = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    let page = startPage;

    while (totalAnime < maxAnime) {
        console.log(`\n📄 Anime Sayfası ${page} çekiliyor...`);

        const animeList = await fetchAnimeList(page);

        if (animeList.length === 0) {
            console.log("   ⚠️  Anime listesi boş, sonlandırılıyor.");
            break;
        }

        for (const anime of animeList) {
            if (totalAnime >= maxAnime) break;

            const animeName = anime.title?.english || anime.title?.romaji || "Unknown";
            console.log(`\n🎌 [${totalAnime + 1}/${maxAnime}] ${animeName}`);

            try {
                const characters = await fetchAnimeCharacters(anime.id, animeName);

                if (characters.length === 0) {
                    console.log(`   ⚠️  Karakter bulunamadı`);
                    totalAnime++;
                    continue;
                }

                let animeAdded = 0;
                let animeSkipped = 0;

                for (const char of characters) {
                    const name = char.name?.full || "Unknown";
                    const imageUrl = char.image?.large || "";
                    const favorites = char.favourites || 0;
                    const gender = char.gender || "unknown";

                    try {
                        const result = upsertCharacter(name, animeName, imageUrl, favorites, gender);

                        if (result.action === "added") {
                            totalAdded++;
                            animeAdded++;
                        } else {
                            totalSkipped++;
                            animeSkipped++;
                        }
                    } catch (error) {
                        totalErrors++;
                    }
                }

                console.log(`   ✅ ${animeAdded} eklendi, ${animeSkipped} atlandı (toplam: ${characters.length})`);
                totalAnime++;

            } catch (error) {
                console.error(`   ❌ Hata:`, error);
                totalErrors++;
                totalAnime++;
            }
        }

        page++;

        // İlerleme raporu
        console.log(`\n📊 İlerleme: ${totalAnime}/${maxAnime} anime, ${totalAdded} karakter eklendi`);
    }

    // Rank ataması
    const totalCharacters = assignUniqueRanks();

    // Özet
    console.log("\n" + "=".repeat(50));
    console.log("🎉 İŞLEM TAMAMLANDI!");
    console.log("=".repeat(50));
    console.log(`   🎌 ${totalAnime} anime işlendi`);
    console.log(`   ✅ ${totalAdded} yeni karakter eklendi`);
    console.log(`   ⏭️  ${totalSkipped} karakter zaten vardı`);
    console.log(`   ❌ ${totalErrors} hata oluştu`);
    console.log(`   📊 Toplam karakter sayısı: ${totalCharacters}`);
}

// Script'i çalıştır
fetchAllAnimeCharacters();
