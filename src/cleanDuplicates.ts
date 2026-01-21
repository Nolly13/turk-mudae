import { Database } from 'bun:sqlite';
import path from 'path';

const dbPath = path.join(import.meta.dir, "../data/database.sqlite");
const db = new Database(dbPath);

interface Character {
    id: number;
    name: string;
    rank: number;
    value: number;
    series: string;
}

interface UserCharacter {
    id: number;
    user_id: number;
    character_id: number;
}

async function cleanDuplicates() {
    console.log("🧹 Duplicate karakter temizleme başlıyor...\n");

    // 1. Tüm duplicate karakterleri bul (aynı isme sahip birden fazla karakter)
    const duplicates = db.query(`
        SELECT name, COUNT(*) as count, GROUP_CONCAT(id) as ids
        FROM characters
        GROUP BY LOWER(name)
        HAVING COUNT(*) > 1
    `).all() as { name: string; count: number; ids: string }[];

    console.log(`📊 ${duplicates.length} duplicate karakter grubu bulundu.\n`);

    let totalDeleted = 0;
    let totalTransferred = 0;

    for (const dup of duplicates) {
        const ids = dup.ids.split(',').map(Number);

        // Bu gruptaki tüm karakterleri al
        const characters = db.query(`
            SELECT id, name, rank, value, series 
            FROM characters 
            WHERE id IN (${ids.join(',')})
            ORDER BY rank ASC
        `).all() as Character[];

        // En iyi rank'lı karakteri tut (ilk sıradaki)
        const bestChar = characters[0];
        const duplicatesToDelete = characters.slice(1);

        console.log(`\n🔍 "${dup.name}" - ${characters.length} adet bulundu`);
        console.log(`   ✅ Tutulacak: ID ${bestChar.id}, Rank #${bestChar.rank}, Value ${bestChar.value} SC`);

        for (const charToDelete of duplicatesToDelete) {
            // Bu karakteri sahiplenen kullanıcıları kontrol et
            const userChars = db.query(`
                SELECT uc.id, uc.user_id, uc.character_id
                FROM user_characters uc
                WHERE uc.character_id = ?
            `).all(charToDelete.id) as UserCharacter[];

            if (userChars.length > 0) {
                // Kullanıcıların karakterlerini en iyi versiyona transfer et
                for (const userChar of userChars) {
                    // Kullanıcının zaten en iyi versiyona sahip olup olmadığını kontrol et
                    const hasGoodVersion = db.query(`
                        SELECT id FROM user_characters 
                        WHERE user_id = ? AND character_id = ?
                    `).get(userChar.user_id, bestChar.id);

                    if (!hasGoodVersion) {
                        // Sahipliği en iyi versiyona transfer et
                        db.run(`UPDATE user_characters SET character_id = ? WHERE id = ?`, [bestChar.id, userChar.id]);
                        console.log(`   🔄 Kullanıcı ${userChar.user_id}: ID ${charToDelete.id} → ID ${bestChar.id} transfer edildi`);
                        totalTransferred++;
                    } else {
                        // Zaten en iyi versiyona sahipse, duplicate kaydı sil
                        db.run(`DELETE FROM user_characters WHERE id = ?`, [userChar.id]);
                        console.log(`   🗑️ Kullanıcı ${userChar.user_id}: Duplicate sahiplik silindi (zaten en iyi versiyona sahip)`);
                    }
                }
            }

            // character_images tablosundan da temizle
            db.run(`DELETE FROM character_images WHERE character_id = ?`, [charToDelete.id]);

            // Duplicate karakteri sil
            db.run(`DELETE FROM characters WHERE id = ?`, [charToDelete.id]);
            console.log(`   ❌ Silindi: ID ${charToDelete.id}, Rank #${charToDelete.rank}`);
            totalDeleted++;
        }
    }

    console.log("\n" + "=".repeat(50));
    console.log(`✅ Temizlik tamamlandı!`);
    console.log(`   🗑️ ${totalDeleted} duplicate karakter silindi`);
    console.log(`   🔄 ${totalTransferred} sahiplik transfer edildi`);
    console.log("=".repeat(50));
}

cleanDuplicates().catch(console.error);
