// MAL (Jikan API) ve AniList birleşik karakter senkronizasyonu
// Önce AniList'i dener, bulamazsa MAL'da arar
// Her iki kaynaktan da favori sayılarını toplar

import { db } from "./database/db";
import { searchCharacter, calculateRankFromFavorites, calculateValueFromFavorites } from "./utils/jikanApi";
import { searchCharacterAniList } from "./utils/anilistApi";

const MAL_RATE_LIMIT_DELAY = 1100; // 1.1 saniye (Jikan rate limit)
const ANILIST_RATE_LIMIT_DELAY = 700; // 0.7 saniye (AniList rate limit)

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// İsim benzerliğini kontrol et (büyük/küçük harf duyarsız)
function isNameMatch(searchName: string, resultName: string): boolean {
    const s = searchName.toLowerCase().trim();
    const r = resultName.toLowerCase().trim();
    return s === r || r.includes(s) || s.includes(r);
}

interface SyncResult {
    malFavorites: number;
    anilistFavorites: number;
    totalFavorites: number;
    imageUrl: string;
    source: "MAL" | "AniList" | "Both" | "None";
}

async function searchBothSources(name: string): Promise<SyncResult> {
    let malFavorites = 0;
    let anilistFavorites = 0;
    let imageUrl = "";
    let malFound = false;
    let anilistFound = false;

    // AniList'te ara (daha hızlı rate limit)
    try {
        const anilistResults = await searchCharacterAniList(name);
        if (anilistResults.length > 0) {
            const match = anilistResults.find(r => isNameMatch(name, r.name.full)) || anilistResults[0];
            anilistFavorites = match.favourites || 0;
            if (!imageUrl && match.image?.large) {
                imageUrl = match.image.large;
            }
            anilistFound = true;
        }
    } catch (error) {
        console.error(`  ⚠️  AniList hatası: ${error}`);
    }

    // MAL'da ara
    await delay(MAL_RATE_LIMIT_DELAY);
    try {
        const malResults = await searchCharacter(name);
        if (malResults.length > 0) {
            const match = malResults.find(r => isNameMatch(name, r.name)) || malResults[0];
            malFavorites = match.favorites || 0;
            // MAL resmi daha kaliteli olabilir, varsa tercih et
            if (match.images?.jpg?.image_url) {
                imageUrl = match.images.jpg.image_url;
            }
            malFound = true;
        }
    } catch (error) {
        console.error(`  ⚠️  MAL hatası: ${error}`);
    }

    // Toplam favorileri hesapla (en yüksek olanı al, toplamı değil - aynı kişi olabilir)
    const totalFavorites = Math.max(malFavorites, anilistFavorites);

    let source: "MAL" | "AniList" | "Both" | "None" = "None";
    if (malFound && anilistFound) source = "Both";
    else if (malFound) source = "MAL";
    else if (anilistFound) source = "AniList";

    return {
        malFavorites,
        anilistFavorites,
        totalFavorites,
        imageUrl,
        source
    };
}

async function syncWithBothSources() {
    console.log("🔄 MAL + AniList Birleşik Senkronizasyonu başlıyor...\n");

    // Tüm karakterleri al
    const characters = db.query("SELECT id, name, series FROM characters").all() as any[];

    let updated = 0;
    let malOnly = 0;
    let anilistOnly = 0;
    let both = 0;
    let notFound = 0;
    let errors = 0;

    for (let i = 0; i < characters.length; i++) {
        const char = characters[i];
        console.log(`[${i + 1}/${characters.length}] ${char.name} aranıyor...`);

        try {
            const result = await searchBothSources(char.name);

            if (result.source !== "None") {
                const rank = calculateRankFromFavorites(result.totalFavorites);
                const value = calculateValueFromFavorites(result.totalFavorites);

                // Veritabanını güncelle
                if (result.imageUrl) {
                    db.run(
                        "UPDATE characters SET rank = ?, value = ?, image_url = ? WHERE id = ?",
                        [rank, value, result.imageUrl, char.id]
                    );
                } else {
                    db.run(
                        "UPDATE characters SET rank = ?, value = ? WHERE id = ?",
                        [rank, value, char.id]
                    );
                }

                // Kaynak bilgisini göster
                let sourceInfo = "";
                if (result.source === "Both") {
                    sourceInfo = `MAL: ${result.malFavorites} + AL: ${result.anilistFavorites}`;
                    both++;
                } else if (result.source === "MAL") {
                    sourceInfo = `MAL: ${result.malFavorites}`;
                    malOnly++;
                } else if (result.source === "AniList") {
                    sourceInfo = `AL: ${result.anilistFavorites}`;
                    anilistOnly++;
                }

                console.log(`  ✅ ${char.name}: ${sourceInfo} → Rank #${rank}, ${value} SC`);
                updated++;
            } else {
                console.log(`  ⚠️  ${char.name}: Hiçbir kaynakta bulunamadı`);
                notFound++;
            }
        } catch (error) {
            console.error(`  ❌ ${char.name}: Hata -`, error);
            errors++;
        }
    }

    console.log(`\n🎉 Senkronizasyon tamamlandı!`);
    console.log(`   ✅ ${updated} karakter güncellendi`);
    console.log(`      📊 ${both} karakter her iki kaynakta bulundu`);
    console.log(`      🔵 ${malOnly} karakter sadece MAL'da bulundu`);
    console.log(`      🟣 ${anilistOnly} karakter sadece AniList'te bulundu`);
    console.log(`   ⚠️  ${notFound} karakter hiçbir kaynakta bulunamadı`);
    console.log(`   ❌ ${errors} hata oluştu`);

    // Benzersiz rank ataması yap
    console.log(`\n🔄 Benzersiz rank ataması yapılıyor...`);
    assignUniqueRanks();
}

// Tüm karakterlere değerlerine göre benzersiz rank ata
function assignUniqueRanks() {
    const characters = db.query(`
        SELECT id, name, value 
        FROM characters 
        ORDER BY value DESC, id ASC
    `).all() as any[];

    let updated = 0;
    for (let i = 0; i < characters.length; i++) {
        const newRank = i + 1;
        db.run("UPDATE characters SET rank = ? WHERE id = ?", [newRank, characters[i].id]);
        updated++;
    }

    console.log(`   ✅ ${updated} karaktere benzersiz rank atandı (1-${characters.length})`);

    // Duplike kontrolü
    const dupes = db.query(`
        SELECT rank, COUNT(*) as cnt 
        FROM characters 
        GROUP BY rank 
        HAVING cnt > 1
    `).all() as any[];

    if (dupes.length === 0) {
        console.log(`   ✅ Tüm ranklar benzersiz!`);
    } else {
        console.log(`   ⚠️  ${dupes.length} duplike rank var`);
    }
}

// Script'i çalıştır
syncWithBothSources();

