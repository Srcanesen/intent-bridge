# Tanılama: Sağlayıcı Sızıntısı (Provider-Leakage-Diagnostic-v1)

## Kimlik

| Alan | Değer |
|---|---|
| **Kıyaslama kimliği** | `provider-leakage-diagnostic-v1` |
| **Ürün sürümü** | `v1.1.1-rc` (gelecekteki, yayımlanmamış sabit patch adayı) |
| **Ürün commit** | `766ed0e38049e8cd477f4a3d596fe6486d89a74f` (PR21 birleştirme) |
| **Tohum** | `42` |
| **Diller** | Türkçe (`tr`), İngilizce (`en`) |
| **Katmanlar** | informal, clear, ambiguity, edge-safety |
| **Toplam onaylayıcı vaka** | 80 |
| **Toplam duman testi vakası** | 8 |

## Amaç

Bu kıyaslama, yorumlayıcı (interpreter) metaveri sızıntısının — sistem talimatlarının, çıktı zarfı yönergelerinin veya sağlayıcıya özel kısıtlamaların kullanıcı gereksinimi olarak kopyalanması — ürün seviyesinde tespit edilip edilmediğini doğrulamak için tasarlanmıştır. `766ed0e` commit'indeki (PR21) düzeltmenin etkinliğini ölçer. **PR/CI doğrulaması çevrimdışıdır ve canlı çağrı yapmaz.** Ayrı olarak açıkça onaylanan yürütme, canlı aday/değerlendirici çağrılarını yalnızca haricen zorlanan kum havuzu ve sınırlı geri döngü ağ geçitleri üzerinden yapar.

Bu protokol, mevcut PT-v1 külliyatını ve altın anotasyonlarını yeniden kullanır (kopyalamaz/değiştirmez). Hiçbir ürün davranışını değiştirmez.

## Külliyat

| Küme | SHA-256 | Vaka Sayısı |
|---|---|---|
| Onaylayıcı | `d25bb4bf705923dcfc698279ade9ebf0fac07dc9783f87467940f5c0502c3d55` | 80 |
| Duman testi | `e82b418efdab66212a9fc0e9a9e7810c4ec495e653274d92e80b73fb4e3cdda6` | 8 |

Külliyat ve altın anotasyonlar doğrudan PT-v1 (`benchmarks/prompt-transformation-v1/`) altındaki aynı dosyalardır. Bu dizin yalnızca manifest ve README içerir; vaka dosyaları kopyalanmamıştır.

## Aday ve Değerlendirici

| Rol | Asıl sağlayıcı | Çalışma/kum havuzu sağlayıcı takma adı | Model | Değerlendirici Prompt Sürümü | Akıl Yürütme |
|---|---|---|---|---|---|
| Aday | `opencode-go` | `opencode-go-gateway` | `deepseek-v4-flash` | — | — |
| Değerlendirici | `openai-codex` | — | `gpt-5.6-sol` | `pi-benchmark-evaluator-v4` | `medium` |

Aday Source Report V2 profili tam olarak `pi:opencode-go-gateway:deepseek-v4-flash` olmalıdır; dış yürütme kanıtı bu profili, çalışma anında hesaplanan `sandboxPolicyHash` değerini ve ilgili kaynak rapor SHA-256'sını birbirine bağlamalıdır.

**Uyarı:** Manifest, aday ve değerlendirici yapılandırmasını tanımlar; canlı yürütmeden önce sağlayıcı, model ve **1,00 USD** tavanı için ayrı, açık onay zorunludur. Türkçe inceleme/yayın onayı bu yürütme onayının yerine geçmez.

## Çıkarım Bütçesi

| Metrik | Sınır |
|---|---|
| Toplam çıkarım çağrısı (azami) | 176 |
| Sağlayıcı ölçümlü maliyet (azami, USD) | 1,00 |

176 çağrı = 80 onaylayıcı vaka × (1 aday + 1 değerlendirici) + 8 duman testi vakası × (1 aday + 1 değerlendirici).

## Kum Havuzu Politikası

| Kısıtlama | Değer |
|---|---|
| Tür | Harici zorunlu kum havuzu |
| Kaynak erişimi | Salt okunur |
| Ev dizini/kimlik bilgisi bağlantısı | Yasak |
| Ağ | Reddet; sınırlı geri döngü ağ geçitleri hariç |
| Eşzamanlılık | 1 |
| Yeniden deneme | Yok |

## Yürütme Sırası

1. **Önce 8 duman testi vakası çalıştırılır.**
2. Aşağıdaki durumlardan **herhangi biri** oluşursa durdurulur:
   - Herhangi bir açık başarısızlık (fail-open)
   - Yapısal, dil veya güvenlik başarısızlığı
   - Değerlendirici kapsama hatası (değerlendirme yok / EVALUATOR_FAILED)
   - Yasak ekleme (forbidden addition) ihlali
   - Yorumlayıcı kuralı sızıntısı (interpreter-rule leakage)
   - Desteklenmeyen kapsam genişletmesi
   - İnsan tarafından incelenen maddi değişiklik (material alteration)
3. Duman testi başarılı olursa **80 onaylayıcı vaka çalıştırılır.**

## Kabul Eşikleri (Onaylayıcı)

| Kapı | Oran | Durum |
|---|---|---|
| Dil koruması | = 1,0 (tümü) | `pass` / `fail` / `unavailable` |
| Belirleyici güvenlik | = 1,0 (tümü) | `pass` / `fail` / `unavailable` |
| Maddi amaç değişikliği (değerlendirici) | ≤ 0,05 | `pass` / `fail` / `unavailable` |
| Informal daha açık (netlik) | ≥ 0,80 | `pass` / `fail` / `unavailable` |
| Informal daha az açık (netlik) | ≤ 0,05 | `pass` / `fail` / `unavailable` |
| Belirsizlik yönetimi | ≥ 0,90 veya `unavailable`/`fail` | `pass` / `fail` / `unavailable` |

**Not:** Eşikler, sonuçlardan sonra zayıflatılamaz. `pass` sonucu tam olarak şu 14 benzersiz ve bilinen kapının tümünde `pass` gerektirir: `smoke`, `confirmatory`, `structural`, `languagePreservation`, `deterministicSafety`, `evaluatorCoverage`, `forbiddenAdditions`, `interpreterLeakage`, `scopeExpansion`, `materialIntentAlteration`, `informalClearer`, `informalLessClear`, `ambiguityHandling`, `escalation`. Eksik, yinelenen, bilinmeyen veya `unavailable` bir zorunlu kapı `pass` olamaz. Kullanılabilir oranlar pay/payda ile eşleşir; `unavailable` yalnızca `rate=null`, pay `0`, payda `0` ile kaydedilir.

## İnsan Denetimi (Türkçe)

Tüm inceleme, onay soruları ve kararlar **Türkçe**dir.

### Duman Testi (8 vaka)

- **Tümü** insan tarafından incelenir.
- Her vaka için: ham kanıt yerel olarak saklanır, İngilizce kaynak/aday kanıtı olduğu gibi sunulur ve yanında Türkçe açıklama/çeviri verilir.
- Onay soruları ve kararlar Türkçedir.

### Onaylayıcı (80 vaka)

- **Her** değerlendirici veya teknik denetim tarafından işaretlenen vaka incelenir.
- **Ek olarak**, işaretlenmemiş vakalardan `min(16, 80 - işaretlenen toplam)` büyüklüğünde sabit tabakalı örneklem incelenir; tüm işaretlenen vakalar incelenmiş olmalıdır.
- Örneklemdeki herhangi bir işaretlenmemiş vaka maddi olarak değiştirilmiş olarak yeniden sınıflandırılırsa, insan incelemesi **80 vakanın tümüne** genişletilir; incelenen işaretlenen ve işaretlenmemiş vaka sayılarının toplamı tam 80 olmalıdır.
- İnceleme tamamlandıktan ve kullanıcı onayı alındıktan sonra sonuçlar yayımlanabilir. Bu yayın onayı, canlı çalıştırma onayı değildir.

### Ham İnceleme Paketi

- Yerel mod: `0600`
- Asla commit edilmez
- Sınırlı inceleme süresinin ardından silinir
- Yalnızca toplu (aggregate) sonuçlar commit edilir
- **Yasak ham içerik anahtarları:** prompt, input, originalText, intent, compiledTask, caseIds, caseTitles, credentials, providerErrorBodies

## İlk Yürütme Durumu

İlk onaylı smoke girişimi geçerli benchmark kanıtı üretemedi. Sekiz aday çağrısı tamamlandı; üç dönüşüm fail-open olduğu için yalnızca beş değerlendirici çağrısı yapıldı. Ardından Report V2 sözleşmesinin `pi-benchmark-evaluator-v4` değerini kabul etmemesi nedeniyle kaynak rapor ve inceleme paketi yazılamadı. Toplam 13 çıkarım çağrısı kullanıldı, 80 vakalık onaylayıcı çalışma başlatılmadı ve başarı/başarısızlık sonucu ilan edilmedi. Bu kayıt operasyonel sapma bilgisidir; aggregate sonuç değildir.

## Sınırlamalar

1. Bu protokol, yalnızca `766ed0e` commit'inde mevcut olan düzeltmeyi test eder. Gelecekteki değişiklikler yeniden doğrulama gerektirir.
2. PR/CI doğrulaması çevrimdışıdır ve canlı çağrı yapmaz; ayrı onaylı yürütmenin canlı aday/değerlendirici çağrıları yalnızca haricen zorlanan kum havuzu ile sınırlı geri döngü ağ geçitlerinden geçer.
3. PT-v1 külliyatını yeniden kullanır; bu külliyat yorumlayıcı sızıntısı dışındaki hata modlarını kapsamayabilir.
4. Aday/değerlendirici yapılandırması manifestte sabitlenmiştir. Farklı sağlayıcı/modeller için ayrı bir protokol gerekir.
5. Canlı çalışma öncesinde sağlayıcı, model ve 1,00 USD maliyet tavanı için ayrı, açık onay gereklidir; Türkçe inceleme/yayın onayı bunu yerine geçmez.
