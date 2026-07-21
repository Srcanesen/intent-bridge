# Kaynağa dayalı kanıt v3

Bu belge, Pi-native v6 OpenAI-compatible-v5 dondurulmuş ön kaydı için `source-grounded-evidence-v3`tür. Konu sürümü `v1.2.0-rc`, konu taahhüdü `16e82444333286e913d048856b9283b329b9872f` ve Pi promptu `pi-native-v6`dır.

Smoke korpusu ve anotasyonları kopyalanmadan [`../source-grounded-evidence-v1/cases.json`](../source-grounded-evidence-v1/cases.json) ve [`../source-grounded-evidence-v1/annotations.json`](../source-grounded-evidence-v1/annotations.json) üzerinden kullanılır. Kanonik SHA-256 değerleri sırasıyla `f0ef68b6fb49eb7641af1d088ecc79e68905ed70589aef671804b5772ce8eba6` ve `ae6466edeec01c65b638f4d1379b9449a867b703c94b7132d384dde0273126f9`dur. Değişmeden kullanılan 80 PT-v1 doğrulayıcı hash'i `d25bb4bf705923dcfc698279ade9ebf0fac07dc9783f87467940f5c0502c3d55`dur.

V1 ve V2 stopped sonuçları tarihsel ve bağımsızdır; bu ön kayıt onları değiştirmez veya yeniden yorumlamaz. PR/CI yalnızca çevrimdışı doğrulama yapar, canlı çağrı yapmaz.

## Protokol

Önce tam sekiz smoke örneği çalıştırılır ve sekizinin de Türkçe insan incelemesi yapılır. Herhangi bir sert kapıda başarısızlık olursa 80 doğrulayıcı örnek çalıştırılmadan işlem durur. Smoke geçerse, değişmeden 80 doğrulayıcı örnek çalıştırılır; işaretlenenlerin tamamı ve işaretlenmemişlerden belirleyici 16 örnek Türkçe incelenir. Yeniden sınıflandırma tüm 80 örneğe yükseltir.

Yürütme, kaynak salt-okunur; ev/kimlik bilgisi bağlanmadan; yalnızca sınırlı aday/değerlendirici loopback geçitleriyle; `concurrency: 1`, `retries: 0` dış sandbox içinde yapılır. Ham paket yerel `0600`, silinebilir ve commit dışıdır; yalnızca toplu sonuç commit edilir.

Önerilen sınır 176 çıkarım çağrısı ve sağlayıcı ölçümlü 1,00 USD'dir. Çalıştırma, PR birleştikten **sonra** sağlayıcı/model/maliyet için ayrı ve açık Türkçe onay gerektirir; bu manifest onay değildir.

## Doğrulama

```bash
corepack pnpm benchmark -- sge-v3 validate-manifest
corepack pnpm benchmark -- sge-v3 validate-aggregate /yerel/sanitize-edilmis-sonuc.json
corepack pnpm benchmark:validate:offline
```
