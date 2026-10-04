# Dates du pointage — version 9

Le fichier de pointeuse attendu utilise mois/jour/année : `10/01/2026`, `10/02/2026`, `10/03/2026` sont les 1, 2 et 3 octobre. L'interface française affiche ensuite `01/10/2026`, `02/10/2026`, `03/10/2026`.

## Lecture et sauvegarde

- `pointageDateSource.js` définit le contrat `mdy-visible-v1` et la version 9. Les textes sont lus explicitement en MDY ou ISO.
- Les valeurs Excel numériques conservent leur valeur, texte et format source. Un format personnalisé jour/mois est lu selon le texte visible MDY attendu.
- Les formats Excel intégrés régionaux 14 et 22 (`m/d/yy`, `mm-dd-yy`, `m/d/yy h:mm`) suivent la politique des exports Excel français de ce projet. SheetJS fournit un texte américain qui ne représente pas l'affichage régional d'Excel. Les dates ambiguës sont reconstruites depuis le numéro Excel ; les jours supérieurs à 12 gardent leur calendrier, car une inversion créerait un mois impossible.
- Les formats personnalisés américains `mm/dd/yyyy hh:mm`, les numéros sans format et les dates ISO gardent leur calendrier.
- Les dates sauvegardées sont des chaînes ISO de calendrier local, sans conversion UTC. Les secondes Excel sont conservées, même lorsque le format visible masque les secondes.
- Aucun nom de fichier ne décide de la date. Les recalculs et corrections gardent les cellules originales des pointages non modifiés.
- Le chargement et l'enregistrement passent par la même normalisation. Une sauvegarde relit les données réelles de Supabase avant d'annoncer sa réussite.
- Les recalculs utilisent la révision SQL `updated_at` pour refuser un snapshot dépassé.

## Déploiement et SQL

1. Publier les modifications de ce projet sur GitHub et déployer ce commit sur le projet Vercel existant. Le dossier de sortie est `dist`, produit par `npm run build`.
2. Dans le SQL Editor du même projet Supabase, exécuter **tout** le fichier `sql/pointage-date-guard.sql`.
3. Le résultat doit contenir `hr_pointage_date_guard`. Les imports antérieurs à la version 9 seront refusés ; les clients doivent charger le nouveau déploiement.

Cette migration SQL installe la validation du contrat source et une révision serveur monotone. Elle ne corrige pas les dates en changeant seulement un numéro de version. Le script de réparation sauvegarde les données avant de recalculer les pointages depuis leur source.

La configuration disponible ici contient uniquement la clé publique Supabase. Elle permet les écritures autorisées dans `hr_dashboard_store`, mais pas l'installation d'un déclencheur SQL.

## Contrôles reproductibles

```powershell
node --test src/lib/pointageDateSource.test.js src/lib/pointageSnapshotDates.test.js
npm run test:sql
npx playwright test tests/ui/pointage-dates.spec.js tests/ui/pointage-store.spec.js --workers=1
npm run build
```

`scripts/repair-pointage-dates.mjs` est limité au fichier `03.xlsx` et à ses 76 pointages confirmés. Sans `--apply`, il vérifie sans écrire. Une sauvegarde source peut être donnée avec `--source-backup` si une ancienne application a supprimé les valeurs Excel ; chaque pointage doit correspondre exactement à l'identité source, au nom, à l'heure et au terminal sauvegardés. Un import concurrent n'est pas remplacé.

`scripts/verify-pointage-live.mjs` contrôle le build de production ou une URL donnée, avec trois rechargements et une attente de dix secondes. Les écritures sont bloquées pendant ce contrôle.

La suite générale contient aussi des échecs préexistants concernant l'historique, les absences et les effectifs. Ils ont été comparés au commit `349e64e` ; ils ne sont pas une validation réussie de ces fonctions.

Références utilisées pour les tests SQL : [PGlite](https://pglite.dev/docs/) et [déclencheurs PostgreSQL](https://www.postgresql.org/docs/current/plpgsql-trigger.html).
