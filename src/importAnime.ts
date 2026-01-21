// Belirli Bir Anime'nin Karakterlerini Çekme Scripti
// Kullanım: bun run src/importAnime.ts "Naruto"
// veya: bun run src/importAnime.ts "Attack on Titan"

import { db, initializeDatabase } from "./database/db";
import { calculateValueFromFavorites } from "./utils/jikanApi";

const ANILIST_API_URL = "https://graphql.anilist.co";
const RATE_LIMIT_DELAY = 700;

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Anime ara
async function searchAnime(query: string): Promise<any[]> {
    const graphqlQuery = `
        query ($search: String) {
            Page(page: 1, perPage: 10) {
                media(search: $search, type: ANIME) {
                    id
                    title {
                        romaji
                        english
                        native
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
                query: graphqlQuery,
                variables: { search: query }
            })
        });

        const data = await response.json() as any;
        return data.data?.Page?.media || [];
    } catch (error) {
        console.error("Anime arama hatası:", error);
        return [];
    }
}

// Anime'nin tüm karakterlerini çek
async function fetchAnimeCharacters(animeId: number): Promise<any[]> {
    const query = `
        query ($id: Int, $page: Int) {
            Media(id: $id, type: ANIME) {
                title {
                    romaji
                    english
                }
                characters(page: $page, perPage: 25, sort: FAVOURITES_DESC) {
                    pageInfo {
                        hasNextPage
                        total
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
    let animeName = "";

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

            const data = await response.json() as any;
            const media = data.data?.Media;

            if (!media) break;

            animeName = media.title?.english || media.title?.romaji || "Unknown";
            const characters = media.characters;

            if (!characters || !characters.edges || characters.edges.length === 0) {
                break;
            }

            console.log(`   📄 Sayfa ${page} - ${characters.edges.length} karakter (Toplam: ${characters.pageInfo?.total || "?"})`);

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

        } catch (error) {
            console.error("Karakter çekme hatası:", error);
            break;
        }
    }

    return allCharacters;
}

// Karakter ekle
function addCharacter(
    name: string,
    series: string,
    imageUrl: string,
    favorites: number,
    gender: string = "unknown"
): { action: "added" | "skipped"; id?: number } {
    const value = calculateValueFromFavorites(favorites);

    // Gender'ı dönüştür
    let genderValue = "unknown";
    if (gender === "Male") genderValue = "male";
    else if (gender === "Female") genderValue = "female";

    // Mevcut karakteri kontrol et
    const existing = db.query(
        "SELECT id FROM characters WHERE LOWER(name) = LOWER(?) AND LOWER(series) = LOWER(?)"
    ).get(name, series) as any;

    if (existing) {
        // Resmi güncelle
        if (imageUrl) {
            db.run("UPDATE characters SET image_url = ?, gender = ? WHERE id = ?", [imageUrl, genderValue, existing.id]);
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

// Benzersiz rank ata
function assignUniqueRanks(): number {
    const characters = db.query(`
        SELECT id, name, value 
        FROM characters 
        ORDER BY value DESC, id ASC
    `).all() as any[];

    for (let i = 0; i < characters.length; i++) {
        db.run("UPDATE characters SET rank = ? WHERE id = ?", [i + 1, characters[i].id]);
    }

    return characters.length;
}

// Ana fonksiyon
async function importAnime() {
    const animeName = process.argv.slice(2).join(" ").trim();

    if (!animeName) {
        console.log("❌ Kullanım: bun run src/importAnime.ts \"Anime İsmi\"");
        console.log("   Örnek: bun run src/importAnime.ts \"Naruto\"");
        console.log("   Örnek: bun run src/importAnime.ts \"Attack on Titan\"");
        process.exit(1);
    }

    console.log(`🔍 "${animeName}" aranıyor...\n`);

    // Veritabanını başlat
    initializeDatabase();

    // Anime'yi ara
    const animeResults = await searchAnime(animeName);

    if (animeResults.length === 0) {
        console.log("❌ Anime bulunamadı!");
        process.exit(1);
    }

    // İlk sonucu kullan
    const anime = animeResults[0];
    const title = anime.title?.english || anime.title?.romaji || "Unknown";

    console.log(`✅ BULUNDU: ${title}`);
    console.log(`   AniList ID: ${anime.id}`);
    console.log(`   Popülerlik: ${anime.popularity}\n`);

    console.log("📥 Karakterler çekiliyor...\n");

    // Karakterleri çek
    const characters = await fetchAnimeCharacters(anime.id);

    if (characters.length === 0) {
        console.log("❌ Karakter bulunamadı!");
        process.exit(1);
    }

    console.log(`\n📊 ${characters.length} karakter bulundu. Veritabanına ekleniyor...\n`);

    let added = 0;
    let skipped = 0;

    for (const char of characters) {
        const name = char.name?.full || "Unknown";
        const imageUrl = char.image?.large || "";
        const favorites = char.favourites || 0;
        const gender = char.gender || "unknown";

        const result = addCharacter(name, title, imageUrl, favorites, gender);

        if (result.action === "added") {
            added++;
            const genderEmoji = gender === "Male" ? "👨" : gender === "Female" ? "👩" : "";
            console.log(`   ✅ ${genderEmoji} ${name} - ${favorites} favori`);
        } else {
            skipped++;
        }
    }

    // Rank ataması
    console.log("\n🔄 Rank ataması yapılıyor...");
    const totalChars = assignUniqueRanks();

    // Özet
    console.log("\n" + "=".repeat(50));
    console.log("🎉 İŞLEM TAMAMLANDI!");
    console.log("=".repeat(50));
    console.log(`   🎌 Anime: ${title}`);
    console.log(`   ✅ ${added} yeni karakter eklendi`);
    console.log(`   ⏭️  ${skipped} karakter zaten vardı`);
    console.log(`   📊 Toplam veritabanı: ${totalChars} karakter`);
}

// Script'i çalıştır
importAnime();
