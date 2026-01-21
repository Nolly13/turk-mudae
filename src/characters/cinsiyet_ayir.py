import requests
import os
import time

def cinsiyetleri_ayir():
    print("--- ANIME KARAKTER CİNSİYET AYRIŞTIRICI ---")
    anime_ismi = input("Hangi animeyi analiz edelim? (Örn: Naruto): ")
    print(f"\n'{anime_ismi}' veritabanında aranıyor...")

    url = 'https://graphql.anilist.co'

    # 1. ADIM: Animeyi Bul
    query_anime = '''
    query ($search: String) {
      Media (search: $search, type: ANIME) {
        id
        title {
          romaji
          english
          native
        }
      }
    }
    '''
    
    try:
        response = requests.post(url, json={'query': query_anime, 'variables': {'search': anime_ismi}})
        data = response.json()

        if not data.get('data') or not data['data'].get('Media'):
            print("HATA: Anime bulunamadı.")
            return

        media = data['data']['Media']
        anime_id = media['id']
        # Dosya ismi için temiz başlık (İngilizce yoksa Romaji al)
        baslik = media['title'].get('english') or media['title'].get('romaji')
        
        print(f"BULUNDU: {baslik}")
        
        # Analiz Klasörü Oluştur
        klasor_adi = f"{baslik}_Cinsiyet_Raporu"
        if not os.path.exists(klasor_adi):
            os.makedirs(klasor_adi)

        print("Karakterler taranıyor (Bu işlem resim indirmekten çok daha hızlıdır)...\n")

        # 2. ADIM: Karakterleri Çek
        query_chars = '''
        query ($id: Int, $page: Int) {
          Media (id: $id, type: ANIME) {
            characters (page: $page, sort: ROLE) {
              pageInfo {
                hasNextPage
              }
              edges {
                role
                node {
                  name {
                    full
                  }
                  gender
                }
              }
            }
          }
        }
        '''

        # Listelerimiz
        liste_erkek = []
        liste_kadin = []
        liste_diger = []

        page = 1
        has_next_page = True

        while has_next_page:
            resp = requests.post(url, json={'query': query_chars, 'variables': {'id': anime_id, 'page': page}})
            if resp.status_code != 200: break
            
            char_data = resp.json()
            data_root = char_data['data']['Media']['characters']
            
            has_next_page = data_root['pageInfo']['hasNextPage']
            edges = data_root['edges']

            for item in edges:
                node = item['node']
                isim = node['name']['full']
                cinsiyet = node.get('gender')
                rol = item['role'] # MAIN veya SUPPORTING

                # Format: Naruto Uzumaki (MAIN)
                satir = f"{isim} - ({rol})"

                if cinsiyet == 'Male':
                    liste_erkek.append(satir)
                elif cinsiyet == 'Female':
                    liste_kadin.append(satir)
                else:
                    # Cinsiyet girilmemiş veya 'Agender' gibi özel durumlar
                    detay = cinsiyet if cinsiyet else "Belirtilmemiş"
                    liste_diger.append(f"{satir} [Veri: {detay}]")

            print(f"Sayfa {page} bitti... (Toplam bulunan: {len(liste_erkek) + len(liste_kadin) + len(liste_diger)})")
            page += 1
            time.sleep(0.2) # Hızlıca tarasın ama ban yemesin

        # 3. ADIM: Dosyalara Yazma
        def dosyaya_yaz(dosya_adi, liste, tur_ismi):
            with open(f"{klasor_adi}/{dosya_adi}", "w", encoding="utf-8") as f:
                f.write(f"ANIME: {baslik}\n")
                f.write(f"KATEGORI: {tur_ismi}\n")
                f.write(f"SAYI: {len(liste)}\n")
                f.write("-" * 40 + "\n")
                for k in liste:
                    f.write(k + "\n")

        dosyaya_yaz("1_Erkekler.txt", liste_erkek, "ERKEK KARAKTERLER")
        dosyaya_yaz("2_Kadinlar.txt", liste_kadin, "KADIN KARAKTERLER")
        dosyaya_yaz("3_Digerleri.txt", liste_diger, "BELİRSİZ / DİĞER")

        # 4. ADIM: Ekrana İstatistik Bas
        toplam = len(liste_erkek) + len(liste_kadin) + len(liste_diger)
        
        print(f"\n✅ İŞLEM TAMAMLANDI!")
        print("-" * 30)
        print(f"📁 Dosyalar şuraya kaydedildi: {klasor_adi}")
        print("-" * 30)
        print(f"📊 İSTATİSTİK RAPORU:")
        print(f"• Toplam Karakter: {toplam}")
        print(f"• 👨 Erkek: {len(liste_erkek)}")
        print(f"• 👩 Kadın: {len(liste_kadin)}")
        print(f"• ❓ Diğer: {len(liste_diger)}")
        
        if toplam > 0:
            oran_e = int((len(liste_erkek)/toplam)*100)
            oran_k = int((len(liste_kadin)/toplam)*100)
            print(f"\nDağılım: %{oran_e} Erkek, %{oran_k} Kadın")

    except Exception as e:
        print(f"Bir hata oluştu: {e}")

if __name__ == "__main__":
    cinsiyetleri_ayir()
    input("\nÇıkmak için Enter'a bas...")