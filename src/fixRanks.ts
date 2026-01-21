// Rank düzeltme scripti
// Tüm karakterleri değerlerine göre sıralar ve 1'den başlayarak benzersiz rank verir
// Bu sayede aynı rank'a sahip karakter olmaz

import { db } from "./database/db";

function fixRanks() {
    console.log("🔄 Rank düzeltme başlıyor...\n");

    // Tüm karakterleri değerine göre sırala (yüksekten düşüğe)
    const characters = db.query(`
        SELECT id, name, value, rank 
        FROM characters 
        ORDER BY value DESC, id ASC
    `).all() as any[];

    console.log(`📊 Toplam ${characters.length} karakter bulundu\n`);

    let updated = 0;

    // Her karaktere benzersiz rank ver (1'den başlayarak)
    for (let i = 0; i < characters.length; i++) {
        const newRank = i + 1; // 1'den başla
        const char = characters[i];

        if (char.rank !== newRank) {
            db.run("UPDATE characters SET rank = ? WHERE id = ?", [newRank, char.id]);

            if (updated < 20) { // İlk 20 değişikliği göster
                console.log(`  #${newRank} ${char.name} (Değer: ${char.value} SC) [eski: #${char.rank}]`);
            }
            updated++;
        }
    }

    if (updated > 20) {
        console.log(`  ... ve ${updated - 20} karakter daha\n`);
    }

    console.log(`\n🎉 Rank düzeltme tamamlandı!`);
    console.log(`   ✅ ${updated} karakterin rankı güncellendi`);
    console.log(`   📊 Ranklar şimdi 1'den ${characters.length}'e kadar benzersiz`);

    // Kontrol et
    const dupes = db.query(`
        SELECT rank, COUNT(*) as cnt 
        FROM characters 
        GROUP BY rank 
        HAVING cnt > 1
    `).all() as any[];

    if (dupes.length === 0) {
        console.log(`   ✅ Duplike rank yok - her karakter benzersiz ranka sahip!`);
    } else {
        console.log(`   ⚠️  Hala ${dupes.length} duplike rank var (bu olmamalı!)`);
    }
}

// Script'i çalıştır
fixRanks();
