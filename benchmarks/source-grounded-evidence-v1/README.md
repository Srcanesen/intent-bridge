# Kaynağa dayalı kanıt v1

Bu belge, `source-grounded-evidence-v1` için dondurulmuş ön kayıttır. Konu sürümü `v1.2.0-rc`, konu taahhüdü `9d54bb4a8ba6a9cc63c0776023d5856c46199697`dir. Eski PT-v1 korpusu ve anotasyonları değiştirilmeden, doğrulayıcı bölümdeki 80 örnek ile sabit SHA-256 değeri yeniden kullanılır.

## Çevrimdışı sözleşme

PR ve CI yalnızca manifest ve sanitize edilmiş toplu sonuç doğrular; canlı çağrı yapmaz. Yeni sekiz örneğin (4 TR, 4 EN) tamamı önce çalıştırılır. Açık başarısızlık, eksik/geçersiz kanıt, yapısal/dil/güvenlik/değerlendirici açığı, yorumlayıcı metaverisi sızıntısı, desteklenmeyen kısıt/kapsam/yöntem, yanlış açık/isimleşmiş/alıntı sınıflaması veya yanlış belirsizlik davranışında işlem durur. Ancak bundan sonra 80 örnek çalıştırılabilir.

Canlı yürütme ayrıca ve açıkça onaylanmış dış sandbox gerektirir: kaynak salt-okunur, ev/kimlik bilgisi bağlanmaz, ağ yalnızca sınırlı loopback geçitleri dışında kapalıdır, eşzamanlılık 1 ve yeniden deneme 0'dır. Önerilen üst sınırlar 176 çıkarım çağrısı ve sağlayıcı ölçümlü 1,00 USD'dir; bu sınırlar maliyet onayı yerine geçmez.

## İnceleme ve saklama

Sekiz smoke örneğinin insan incelemesi Türkçedir. İngilizce ham kanıt için Türkçe açıklama/çeviri gerekir. Doğrulayıcıda işaretlenenlerin tümü ile işaretlenmemişlerden belirleyici katmanlı 16 örnek incelenir; yeniden sınıflama tüm 80 örneğe yükseltir. Onay soruları ve kararları Türkçedir.

Ham inceleme paketi yalnızca yerelde, `0600` izinle tutulur; commit edilmez ve inceleme sonunda silinir. Yalnızca toplu özet saklanır. Sözleşme prompt, input, özgün metin, intent, derlenmiş görev, kanıt alıntısı/öğesi, örnek kimliği/başlığı, kimlik bilgisi ve sağlayıcı hata gövdesini özyinelemeli olarak reddeder.

Korunan sayısal kapılar: dil ve güvenlik %100; maddi değişiklik en çok %5; gayriresmî açıklık en az %80; daha az açık en çok %5; belirsizlik en az %90. Ek olarak kanıt kapsamı %100, smoke belirsizlik davranışı birebirdir.

## Doğrulama

```bash
corepack pnpm benchmark -- sge validate-manifest
corepack pnpm benchmark -- sge validate-aggregate /yerel/sanitize-edilmis-sonuc.json
corepack pnpm benchmark:validate:offline
```
