import requests
import os
import time

def dosya_ismini_temizle(isim):
    # Windows dosya isimlerinde yasaklı karakterleri temizler (<, >, :, ", /, \, |, ?, *)
    yasakli = ['<', '>', ':', '"', '/', '\\', '|', '?', '*']
    for char in yasakli:
        isim = isim.replace(char, '')
    return isim.strip()

def resimli_karakter_indir():
    anime_ismi = input("Hangi animeyi arıyorsun? (Örn: Bleach): ")
    print(f"\n'{anime_ismi}' için AniList taranıyor...")

    url = 'https://graphql.anilist.co'

    # --- 1. ANİMEYİ BUL ---
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
    
    variables = {'search': anime_ismi}

    try:
        response = requests.post(url, json={'query': query_anime, 'variables': variables})
        json_data = response.json()

        if json_data.get('data') is None or json_data['data'].get('Media') is None:
            print("HATA: Anime bulunamadı.")
            return

        media = json_data['data']['Media']
        anime_id = media['id']
        # İsim önceliği: İngilizce > Romaji > ID
        raw_title = media['title'].get('english') or media['title'].get('romaji') or str(anime_id)
        
        # Klasör ismi için temizlik yap
        clean_title = dosya_ismini_temizle(raw_title)
        
        print(f"BULUNDU: {clean_title} (ID: {anime_id})")
        
        # --- KLASÖR OLUŞTURMA ---
        klasor_adi = f"{clean_title}_Karakterleri"
        if not os.path.exists(klasor_adi):
            os.makedirs(klasor_adi)
            print(f"Klasör oluşturuldu: {klasor_adi}")
        else:
            print(f"Klasör zaten var: {klasor_adi} (İçine kaydedilecek)")

        print("Veriler ve resimler indiriliyor... (Bu biraz sürebilir)\n")

        # --- 2. KARAKTERLERİ VE RESİMLERİ ÇEK ---
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
                  image {
                    large
                  }
                }
              }
            }
          }
        }
        '''

        page = 1
        has_next_page = True
        toplam_indirilen = 0

        # İsim listesi için dosya açalım
        with open(f"{klasor_adi}/isim_listesi.txt", "w", encoding="utf-8") as f_text:
            f_text.write(f"ANIME: {clean_title}\n")
            f_text.write("-" * 40 + "\n")

            while has_next_page:
                variables_char = {'id': anime_id, 'page': page}
                resp = requests.post(url, json={'query': query_chars, 'variables': variables_char})
                
                if resp.status_code != 200:
                    print(f"Sayfa {page} hatası, geçiliyor.")
                    break

                char_data = resp.json()
                data_part = char_data.get('data', {}).get('Media', {}).get('characters', {})
                
                if not data_part:
                    break

                has_next_page = data_part['pageInfo']['hasNextPage']
                edges = data_part['edges']

                for item in edges:
                    node = item.get('node')
                    if not node: continue

                    # Bilgileri al
                    isim = node['name']['full']
                    rol = item['role']
                    resim_url = node['image']['large'] # Karakter fotosu linki
                    
                    # Dosya ismini hazırla (Örn: Naruto Uzumaki.jpg)
                    temiz_isim = dosya_ismini_temizle(isim)
                    resim_dosya_yolu = f"{klasor_adi}/{temiz_isim}.jpg"

                    # 1. Metin dosyasına yaz
                    f_text.write(f"{isim} - [{rol}]\n")

                    # 2. Resmi İndir (Eğer daha önce indirilmediyse)
                    if not os.path.exists(resim_dosya_yolu):
                        try:
                            img_data = requests.get(resim_url).content
                            with open(resim_dosya_yolu, 'wb') as handler:
                                handler.write(img_data)
                            print(f"✅ İndirildi: {isim}")
                        except Exception as img_err:
                            print(f"❌ Resim hatası ({isim}): {img_err}")
                    else:
                        print(f"♻️ Zaten var: {isim}")

                    toplam_indirilen += 1
                    
                    # Çok yüklenmemek için milisaniye bekle
                    time.sleep(0.1)

                print(f"--- Sayfa {page} bitti ---\n")
                page += 1
                time.sleep(1) # Sayfa geçişlerinde 1 saniye bekle

    except Exception as e:
        print(f"\nBeklenmeyen bir hata: {e}")

    print(f"\n🏁 İŞLEM TAMAMLANDI!")
    print(f"Tüm dosyalar şu klasörde: {os.getcwd()}\\{klasor_adi}")

if __name__ == "__main__":
    resimli_karakter_indir()
    input("\nÇıkmak için Enter'a bas...")