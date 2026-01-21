// MAL (Jikan API) ve AniList birleşik karakter senkronizasyonu - HIZLI VERSİYON
// Paralel işleme ile çok daha hızlı çalışır
// AniList öncelikli (daha hızlı rate limit: 90 req/min)

import { db } from "./database/db";
import { searchCharacter, calculateValueFromFavorites } from "./utils/jikanApi";
import { searchCharacterAniList } from "./utils/anilistApi";

const BATCH_SIZE = 5; // Aynı anda kaç karakter işlenecek
const BATCH_DELAY = 800; // Batch'ler arası bekleme (ms)

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// İsim benzerliğini kontrol et
function isNameMatch(searchName: string, resultName: string): boolean {
    const s = searchName.toLowerCase().trim();
    const r = resultName.toLowerCase().trim();
    return s === r || r.includes(s) || s.includes(r);
}

interface SyncResult {
    id: number;
    name: string;
    favorites: number;
    imageUrl: string;
    source: "MAL" | "AniList" | "None";
    value: number;
}

async function searchCharacterFast(id: number, name: string): Promise<SyncResult> {
    let favorites = 0;
    let imageUrl = "";
    let source: "MAL" | "AniList" | "None" = "None";

    // Önce AniList'te ara (daha hızlı)
    try {
        const anilistResults = await searchCharacterAniList(name);
        if (anilistResults.length > 0) {
            const match = anilistResults.find(r => isNameMatch(name, r.name.full)) || anilistResults[0];
            if (match) {
                favorites = match.favourites || 0;
                imageUrl = match.image?.large || "";
                source = "AniList";
            }
        }
    } catch (error) {
        // AniList hatası, MAL'a geç
    }

    // AniList'te bulunamadıysa MAL'da ara
    if (source === "None") {
        try {
            const malResults = await searchCharacter(name);
            if (malResults.length > 0) {
                const match = malResults.find(r => isNameMatch(name, r.name)) || malResults[0];
                if (match) {
                    favorites = match.favorites || 0;
                    imageUrl = match.images?.jpg?.image_url || "";
                    source = "MAL";
                }
            }
        } catch (error) {
            // MAL hatası
        }
    }

    const value = calculateValueFromFavorites(favorites);

    return { id, name, favorites, imageUrl, source, value };
}

async function syncFast() {
    console.log("🚀 HIZLI Senkronizasyon başlıyor (paralel işleme)...\n");

    const characters = db.query("SELECT id, name FROM characters").all() as any[];
    const total = characters.length;

    let updated = 0;
    let anilistFound = 0;
    let malFound = 0;
    let notFound = 0;

    const startTime = Date.now();

    // Batch'ler halinde işle
    for (let i = 0; i < total; i += BATCH_SIZE) {
        const batch = characters.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(total / BATCH_SIZE);

        console.log(`[Batch ${batchNum}/${totalBatches}] ${batch.map(c => c.name).join(", ")}`);

        // Paralel olarak tüm batch'teki karakterleri ara
        const results = await Promise.all(
            batch.map(char => searchCharacterFast(char.id, char.name))
        );

        // Sonuçları işle
        for (const result of results) {
            if (result.source !== "None") {
                // Veritabanını güncelle
                if (result.imageUrl) {
                    db.run(
                        "UPDATE characters SET value = ?, image_url = ? WHERE id = ?",
                        [result.value, result.imageUrl, result.id]
                    );
                } else {
                    db.run(
                        "UPDATE characters SET value = ? WHERE id = ?",
                        [result.value, result.id]
                    );
                }

                if (result.source === "AniList") anilistFound++;
                else if (result.source === "MAL") malFound++;
                updated++;
            } else {
                notFound++;
            }
        }

        // Batch'ler arası bekleme (rate limit için)
        if (i + BATCH_SIZE < total) {
            await delay(BATCH_DELAY);
        }

        // İlerleme göster
        const elapsed = (Date.now() - startTime) / 1000;
        const progress = ((i + BATCH_SIZE) / total) * 100;
        const eta = (elapsed / (i + BATCH_SIZE)) * (total - i - BATCH_SIZE);
        console.log(`  📊 İlerleme: ${Math.min(100, progress).toFixed(1)}% | ETA: ${Math.ceil(eta)}s\n`);
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`\n🎉 Senkronizasyon tamamlandı! (${totalTime} saniye)`);
    console.log(`   ✅ ${updated} karakter güncellendi`);
    console.log(`      🟣 ${anilistFound} AniList'te bulundu`);
    console.log(`      🔵 ${malFound} MAL'da bulundu`);
    console.log(`   ⚠️  ${notFound} karakter bulunamadı`);

    // Benzersiz rank ataması
    console.log(`\n🔄 Benzersiz rank ataması yapılıyor...`);
    assignUniqueRanks();
}

function assignUniqueRanks() {
    const characters = db.query(`
        SELECT id, value 
        FROM characters 
        ORDER BY value DESC, id ASC
    `).all() as any[];

    for (let i = 0; i < characters.length; i++) {
        db.run("UPDATE characters SET rank = ? WHERE id = ?", [i + 1, characters[i].id]);
    }

    console.log(`   ✅ ${characters.length} karaktere benzersiz rank atandı`);
}

// Script'i çalıştır
syncFast();
