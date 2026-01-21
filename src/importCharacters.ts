import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { db } from "./database/db";

// Images klasörünün yolu
const IMAGES_DIR = join(import.meta.dir, "images");

interface CharacterEntry {
    name: string;
    role: "MAIN" | "SUPPORTING" | "BACKGROUND";
    series: string;
    category: string;
    imagePath: string | null;
}

// Role'e göre rank hesapla
function calculateRank(role: string, index: number): number {
    if (role === "MAIN") {
        return index + 1; // 1-10 arası
    } else if (role === "SUPPORTING") {
        return 10 + index + 1; // 11-100 arası
    } else {
        return 100 + index + 1; // 100+ 
    }
}

// isim_listesi.txt dosyasını parse et
function parseCharacterList(filePath: string, seriesFolder: string): CharacterEntry[] {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const characters: CharacterEntry[] = [];

    let seriesName = seriesFolder;
    let category = "Anime";

    // İlk satırdan seri adını al
    const firstLine = lines[0];
    const seriesMatch = firstLine?.match(/^ANIME:\s*(.+)$/i);
    if (seriesMatch && seriesMatch[1]) {
        seriesName = seriesMatch[1].trim();
    }

    // Pattern: "Karakter Adı - [ROLE]"
    const characterPattern = /^(.+?)\s*-\s*\[(MAIN|SUPPORTING|BACKGROUND)\]/i;

    const seenNames = new Set<string>();
    let mainIndex = 0;
    let supportingIndex = 0;
    let backgroundIndex = 0;

    for (const line of lines) {
        const match = line.match(characterPattern);
        if (match && match[1] && match[2]) {
            const name = match[1].trim();
            const role = match[2].toUpperCase() as "MAIN" | "SUPPORTING" | "BACKGROUND";

            // Tekrarları atla
            if (seenNames.has(name)) continue;
            seenNames.add(name);

            // Resim yolunu bul
            const imagePath = findCharacterImage(seriesFolder, name);

            // Rank hesapla
            let rank: number;
            if (role === "MAIN") {
                rank = calculateRank(role, mainIndex++);
            } else if (role === "SUPPORTING") {
                rank = calculateRank(role, supportingIndex++);
            } else {
                rank = calculateRank(role, backgroundIndex++);
            }

            characters.push({
                name,
                role,
                series: seriesName,
                category,
                imagePath
            });
        }
    }

    return characters;
}

// Karakter resmini bul
function findCharacterImage(seriesFolder: string, characterName: string): string | null {
    const seriesPath = join(IMAGES_DIR, seriesFolder);

    // .jpg kontrol
    const jpgPath = join(seriesPath, `${characterName}.jpg`);
    if (existsSync(jpgPath)) return jpgPath;

    // .png kontrol
    const pngPath = join(seriesPath, `${characterName}.png`);
    if (existsSync(pngPath)) return pngPath;

    return null;
}

// Rank'a göre değer hesapla
function calculateValue(rank: number): number {
    if (rank === 1) return Math.floor(Math.random() * 5000) + 5000; // 5000-10000
    if (rank <= 5) return Math.floor(Math.random() * 3000) + 2000; // 2000-5000
    if (rank <= 10) return Math.floor(Math.random() * 1500) + 1000; // 1000-2500
    if (rank <= 25) return Math.floor(Math.random() * 700) + 500; // 500-1200
    if (rank <= 50) return Math.floor(Math.random() * 350) + 250; // 250-600
    if (rank <= 100) return Math.floor(Math.random() * 200) + 100; // 100-300
    return Math.floor(Math.random() * 100) + 50; // 50-150
}

// Tüm serileri işle
async function importAllCharacters() {
    console.log("🚀 Karakter ekleme başlıyor...\n");

    const seriesFolders = readdirSync(IMAGES_DIR, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

    let totalAdded = 0;
    let totalSkipped = 0;

    for (const folder of seriesFolders) {
        const listPath = join(IMAGES_DIR, folder, "isim_listesi.txt");

        if (!existsSync(listPath)) {
            console.log(`⚠️  ${folder} klasöründe isim_listesi.txt bulunamadı, atlanıyor...`);
            continue;
        }

        console.log(`📁 ${folder} işleniyor...`);
        const characters = parseCharacterList(listPath, folder);

        for (let i = 0; i < characters.length; i++) {
            const char = characters[i];

            // Karakterin zaten var olup olmadığını kontrol et
            const existing = db.query(
                "SELECT id FROM characters WHERE name = ? AND series = ?"
            ).get(char.name, char.series);

            if (existing) {
                totalSkipped++;
                continue;
            }

            // Rank hesapla (MAIN 1-10, SUPPORTING 11+)
            let rank: number;
            if (char.role === "MAIN") {
                rank = i + 1;
            } else if (char.role === "SUPPORTING") {
                rank = 10 + i;
            } else {
                rank = 100 + i;
            }

            const value = calculateValue(rank);

            // Karakteri ekle
            db.run(
                "INSERT INTO characters (name, series, category, image_url, rank, value) VALUES (?, ?, ?, ?, ?, ?)",
                [char.name, char.series, char.category, char.imagePath || "", rank, value]
            );

            // Eğer yerel resim varsa, character_images tablosuna da ekle
            if (char.imagePath) {
                const charId = (db.query("SELECT id FROM characters WHERE name = ? AND series = ?").get(char.name, char.series) as any)?.id;
                if (charId) {
                    db.run(
                        "INSERT INTO character_images (character_id, image_url, is_local) VALUES (?, ?, 1)",
                        [charId, char.imagePath]
                    );
                }
            }

            totalAdded++;
            console.log(`  ✅ ${char.name} (${char.role}) eklendi - Rank: #${rank}, Değer: ${value} SC`);
        }
    }

    console.log(`\n🎉 Tamamlandı!`);
    console.log(`   ✅ ${totalAdded} karakter eklendi`);
    console.log(`   ⏭️  ${totalSkipped} karakter zaten vardı (atlandı)`);
}

// Script'i çalıştır
importAllCharacters();
