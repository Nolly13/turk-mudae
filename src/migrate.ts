// Migration scripti - yeni kolonları ekler
import { Database } from "bun:sqlite";
import path from "path";

const dbPath = path.join(import.meta.dir, "../data/database.sqlite");
const db = new Database(dbPath);

const columns = [
    { name: "claim_cooldown_at", sql: "ALTER TABLE users ADD COLUMN claim_cooldown_at DATETIME" },
    { name: "bonus_claims", sql: "ALTER TABLE users ADD COLUMN bonus_claims INTEGER DEFAULT 0" },
    { name: "bonus_rolls", sql: "ALTER TABLE users ADD COLUMN bonus_rolls INTEGER DEFAULT 0" },
];

console.log("🔄 Migration başlıyor...\n");

for (const col of columns) {
    try {
        db.run(col.sql);
        console.log(`✅ ${col.name} eklendi`);
    } catch (e: any) {
        if (e.message?.includes("duplicate column")) {
            console.log(`⏭️  ${col.name} zaten var`);
        } else {
            console.log(`❌ ${col.name} hatası:`, e.message);
        }
    }
}

db.close();
console.log("\n🎉 Migration tamamlandı!");
