// Seri Bazlı Cinsiyet Güncelleme (AniList + MAL)
// Kullanım: 
//   bun run src/updateGenders.ts              → Tüm serileri güncelle
//   bun run src/updateGenders.ts "Naruto"     → Sadece Naruto serisini güncelle

import { db, initializeDatabase } from "./database/db";

const ANILIST_API_URL = "https://graphql.anilist.co";
const JIKAN_API_URL = "https://api.jikan.moe/v4";

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// AniList'ten seri karakterlerini çek
async function getCharactersFromAniList(searchName: string): Promise<Map<string, string>> {
    const characterMap = new Map<string, string>();

    const searchQuery = `
        query ($search: String) {
            Media(search: $search, type: ANIME) { id }
        }
    `;

    try {
        const searchResp = await fetch(ANILIST_API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: searchQuery, variables: { search: searchName } })
        });

        if (!searchResp.ok) return characterMap;

        const searchData = await searchResp.json() as any;
        const animeId = searchData.data?.Media?.id;
        if (!animeId) return characterMap;

        const charQuery = `
            query ($id: Int, $page: Int) {
                Media(id: $id, type: ANIME) {
                    characters(page: $page, sort: FAVOURITES_DESC, perPage: 25) {
                        pageInfo { hasNextPage }
                        edges { node { name { full } gender } }
                    }
                }
            }
        `;

        let page = 1;
        let hasNextPage = true;

        while (hasNextPage && page <= 10) {
            await delay(300);
            const charResp = await fetch(ANILIST_API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: charQuery, variables: { id: animeId, page } })
            });

            if (!charResp.ok) break;
            const charData = await charResp.json() as any;
            const characters = charData.data?.Media?.characters;
            if (!characters) break;

            for (const edge of characters.edges || []) {
                const name = edge.node?.name?.full;
                const gender = edge.node?.gender;
                if (name && gender) {
                    characterMap.set(name.toLowerCase(), gender);
                }
            }

            hasNextPage = characters.pageInfo?.hasNextPage || false;
            page++;
        }
    } catch { }

    return characterMap;
}

// MAL (Jikan) dan seri karakterlerini çek
async function getCharactersFromMAL(searchName: string): Promise<Map<string, string>> {
    const characterMap = new Map<string, string>();

    try {
        await delay(500);
        const searchResp = await fetch(`${JIKAN_API_URL}/anime?q=${encodeURIComponent(searchName)}&limit=1`);
        if (!searchResp.ok) return characterMap;

        const searchData = await searchResp.json() as any;
        const animeId = searchData.data?.[0]?.mal_id;
        if (!animeId) return characterMap;

        await delay(500);
        const charResp = await fetch(`${JIKAN_API_URL}/anime/${animeId}/characters`);
        if (!charResp.ok) return characterMap;

        const charData = await charResp.json() as any;

        for (const char of charData.data || []) {
            const name = char.character?.name;
            const about = char.character?.about?.toLowerCase() || "";

            if (name) {
                let gender: string | null = null;
                if (about.includes("female") || about.includes("girl") || about.includes("woman")) {
                    gender = "Female";
                } else if (about.includes("male") || about.includes("boy") || about.includes("man")) {
                    gender = "Male";
                }

                if (gender) {
                    const normalizedName = name.includes(",")
                        ? name.split(",").reverse().map((s: string) => s.trim()).join(" ")
                        : name;
                    characterMap.set(normalizedName.toLowerCase(), gender);
                }
            }
        }
    } catch { }

    return characterMap;
}

async function getSeriesCharacters(searchName: string): Promise<Map<string, string>> {
    let chars = await getCharactersFromAniList(searchName);
    if (chars.size > 0) return chars;
    return await getCharactersFromMAL(searchName);
}

async function updateGenders() {
    initializeDatabase();

    // Argüman kontrolü
    const targetSeries = process.argv.slice(2).join(" ").trim();

    if (targetSeries) {
        // Tek seri modu
        console.log(`🎯 "${targetSeries}" serisi güncelleniyor...\n`);

        const charGenders = await getSeriesCharacters(targetSeries);

        if (charGenders.size === 0) {
            console.log(`❌ "${targetSeries}" bulunamadı!`);
            return;
        }

        console.log(`📥 ${charGenders.size} karakter bulundu`);

        const dbChars = db.query(`
            SELECT id, name FROM characters 
            WHERE LOWER(series) LIKE LOWER(?)
            AND (gender IS NULL OR gender = 'unknown' OR gender = '')
        `).all(`%${targetSeries}%`) as any[];

        let updated = 0;
        for (const char of dbChars) {
            const gender = charGenders.get(char.name.toLowerCase());
            if (gender) {
                const genderValue = gender === "Male" ? "male" : "female";
                db.run("UPDATE characters SET gender = ? WHERE id = ?", [genderValue, char.id]);
                const emoji = genderValue === "male" ? "♂️" : "♀️";
                console.log(`   ${emoji} ${char.name}`);
                updated++;
            }
        }

        console.log(`\n✅ ${updated} karakter güncellendi`);
        return;
    }

    // Tüm seriler modu
    console.log("🚀 TÜM SERİLER GÜNCELLENİYOR (AniList + MAL)\n");

    const series = db.query(`
        SELECT DISTINCT series FROM characters 
        WHERE gender IS NULL OR gender = 'unknown' OR gender = ''
        ORDER BY series ASC
    `).all() as any[];

    console.log(`📊 ${series.length} farklı seri\n`);

    let totalUpdated = 0;
    const startTime = Date.now();

    for (let i = 0; i < series.length; i++) {
        const seriesName = series[i].series;
        const progress = Math.round(((i + 1) / series.length) * 100);
        console.log(`[${progress}%] 📺 ${seriesName.substring(0, 40)}`);

        const charGenders = await getSeriesCharacters(seriesName);

        if (charGenders.size === 0) {
            console.log(`   ⚠️ Bulunamadı\n`);
            continue;
        }

        const dbChars = db.query(`
            SELECT id, name FROM characters 
            WHERE series = ? AND (gender IS NULL OR gender = 'unknown' OR gender = '')
        `).all(seriesName) as any[];

        let updated = 0;
        for (const char of dbChars) {
            const gender = charGenders.get(char.name.toLowerCase());
            if (gender) {
                db.run("UPDATE characters SET gender = ? WHERE id = ?", [gender === "Male" ? "male" : "female", char.id]);
                updated++;
                totalUpdated++;
            }
        }

        console.log(`   📥 ${charGenders.size} bulundu, ✅ ${updated} güncellendi\n`);
        await delay(400);
    }

    const totalTime = Math.ceil((Date.now() - startTime) / 1000);
    console.log(`🎉 Toplam ${totalUpdated} karakter güncellendi | ${Math.floor(totalTime / 60)}dk ${totalTime % 60}sn`);
}

updateGenders().catch(console.error);
