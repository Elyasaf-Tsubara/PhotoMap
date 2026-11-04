# PhotoMap — תפעול, אבטחה ופרטיות (עדכון 4.11.2026)
## ארכיטקטורה
- קוד עצמאי: GitHub `Elyasaf-Tsubara/PhotoMap` ענף `main`.
- פריסה נוכחית: GitHub `Elyasaf-Tsubara/IndoorNavigation` ענף `master`, כתובת https://indoornavigation.pages.dev.
- Supabase: `bbiwysjmdcvcdrrrfpbs`, מסד PostgreSQL ו-Storage `photos` פרטי, באזור Singapore.
- Edge Functions: `upload-photo-secure`, `report-photo`, `photo-feed`.
- `upload-photo` הישן הושבת ומחזיר HTTP 410; לא להפעילו מחדש.
## תהליך העלאה
1. המשתמש מצלם/בוחר תמונה, ממקם אותה, מאשר גיל וזכויות, מבקש Turnstile.
2. ברירת המחדל היא מיקום מקורב ל-3 ספרות אחרי הנקודה (~100 מטר).
3. הדפדפן מייצר JPEG מוקטן. פונקציית השרת בודקת את הקובץ, מאמתת Turnstile, מפעילה מגבלה עד 8 העלאות ליום למזהה IP מגובב ועד 60 בסך הכול (מסגרת ראשונית למניעת ניצול), מפענחת את התמונה ומייצרת JPEG מחדש ללא metadata/EXIF.
4. תמונה נשמרת ב-Storage הפרטי ורשומה בטבלת `photos` במצב `pending`.
5. רק תמונות `approved` נכללות ב-`photo-feed`, שמחזירה קישורים חתומים לשעה.
## ניהול ידני — אינו מבוצע אוטומטית
- להיכנס ל-Supabase Table Editor בטבלת `photos`; לבדוק כל תמונה לפני שינוי ל-`approved`.
- **אין לאשר תמונות היסטוריות (לפני הפעלת `upload-photo-secure`) ללא בדיקת EXIF/עיבוד מחדש**.
- לבדוק `photo_reports` מדי יום ולהעביר `status` ל-`in_review` ולאחר טיפול ל-`resolved`.
- בבקשת מחיקה מוצדקת, להשתמש ב-Supabase Storage API `.remove([image_path])` ורק אחר כך למחוק או לעדכן רשומת `photos`; אין למחוק ישירות מ-`storage.objects` באמצעות SQL.
- בקשת מחיקה דורשת אימות סביר של זיקה לתמונה כדי למנוע מחיקה זדונית. אין להבטיח מחיקת עותקים שהורדו.
## בקרות בטיחות והגבלות
- RLS מופעל: משתמשים ללא התחברות יכולים לקרוא רשומות תמונות מאושרות בלבד; אין להם הרשאות INSERT/UPDATE/DELETE.
- טבלת `photo_reports` וספירות השימוש אינן קריאות לציבור; פונקציות מוגנות ב-Turnstile.
- `SECURITY DEFINER` quota RPC זמין ל-service_role בלבד.
- יש לבצע בדיקות דפדפן אמיתיות לפני פרסום ציבורי רחב, במיוחד upload חדש, report-photo, קישורים חתומים, נגישות והסרה.
- תמונות ממתינות ישנות עלולות לשמור metadata/EXIF; אין לפרסם אותן ללא טיהור.
- קיימים דפי `privacy.html`, `terms.html`, `accessibility.html`, `report.html` אך זהות מפעיל וכתובת פנייה חיצונית טרם סופקו; זו חסימה להשקה משפטית סופית.
- מנגנון אוטומטי למחיקה אחרי תקופת שמירה סופית **טרם הוגדר**; יש לקבוע מדיניות ולאכוף אותה באחסון ובמסד הנתונים. טבלאות מזהי הגבלת קצב מתנקות בעת פניות חדשות, לא בהכרח ביום מסוים ללא פעילות.
- לא כל בדיקת ציות או אבטחה הושלמה; דרוש ייעוץ משפטי מקומי לפני פרסום שירות רחב.
## ניטור
- בדיקת ציות משפטית שבועית ב-ChatGPT.
- בדיקת דיווחים ופניות חדשות מדי יום ב-ChatGPT (ללא פרסום תוכן התלונות בהתראה).
## מקורות עזר
- [חובת היידוע ברשות להגנת הפרטיות](https://www.gov.il/BlobFolder/legalinfo/duty_to_notify/he/notify13.pdf)
- [OpenStreetMap Tile Policy](https://operations.osmfoundation.org/policies/tiles/)
- [Supabase private Storage](https://supabase.com/docs/guides/storage/serving/downloads)
- [Supabase Delete Objects](https://supabase.com/docs/guides/storage/management/delete-objects)
