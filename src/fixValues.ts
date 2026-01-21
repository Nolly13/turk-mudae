// Karakter değerlerini sıralamaya (rank) göre düzelten script
// Yüksek sıralamalar (düşük rank numarası) daha yüksek değer alır

import { db } from "./database/db";

// Rank'a göre değer hesapla
function calculateValueFromRank(rank: number): number {
    // Rank 1 = en değerli
    if (rank === 1) return 10000;
    if (rank <= 3) return 8000;
    if (rank <= 5) return 6000;
    if (rank <= 10) return 5000;
    if (rank <= 25) return 4000;
    if (rank <= 50) return 3000;
    if (rank <= 100) return 2000;
    if (rank <= 200) return 1500;
    if (rank <= 300) return 1000;
    if (rank <= 500) return 750;
    if (rank <= 700) return 500;
    return 250; // 700+
}

async function fixValues() {
    console.log("🔄 Karakter değerlerini düzeltme başlıyor...\n");

    const characters = db.query("SELECT id, name, rank, value FROM characters ORDER BY rank ASC").all() as any[];

    console.log(`📊 Toplam ${characters.length} karakter işlenecek\n`);

    let updated = 0;
    let unchanged = 0;

    for (const char of characters) {
        const newValue = calculateValueFromRank(char.rank);

        if (char.value !== newValue) {
            db.run("UPDATE characters SET value = ? WHERE id = ?", [newValue, char.id]);
            console.log(`#${char.rank} ${char.name}: ${char.value} → ${newValue} SC`);
            updated++;
        } else {
            unchanged++;
        }
    }

    console.log(`\n🎉 Değer düzeltme tamamlandı!`);
    console.log(`   ✅ ${updated} karakter güncellendi`);
    console.log(`   ⏭️ ${unchanged} karakter zaten doğruydu`);

    // Özet: Rank aralıklarına göre değerler
    console.log(`\n📋 Değer Tablosu:`);
    console.log(`   Rank 1: 10,000 SC`);
    console.log(`   Rank 2-3: 8,000 SC`);
    console.log(`   Rank 4-5: 6,000 SC`);
    console.log(`   Rank 6-10: 5,000 SC`);
    console.log(`   Rank 11-25: 4,000 SC`);
    console.log(`   Rank 26-50: 3,000 SC`);
    console.log(`   Rank 51-100: 2,000 SC`);
    console.log(`   Rank 101-200: 1,500 SC`);
    console.log(`   Rank 201-300: 1,000 SC`);
    console.log(`   Rank 301-500: 750 SC`);
    console.log(`   Rank 501-700: 500 SC`);
    console.log(`   Rank 700+: 250 SC`);
}

fixValues();
