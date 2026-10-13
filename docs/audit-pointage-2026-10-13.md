# Audit du projet RH — 13 octobre 2026

Analyse du code local, des tests et de tous les enregistrements de pointage accessibles dans Supabase. Aucune écriture, suppression, migration ou modification des droits en base pendant cet audit. Les autres projets n'ont pas été modifiés. Cet audit ne certifie pas le code des autres applications ni leurs politiques serveur.

## Résultat principal

Les corrections de dates et de sauvegarde disposent de tests concluants. Toutefois, le projet n'est pas entièrement validé : le mois courant n'est pas reconstitué depuis les archives, les règles d'absence présentent des incohérences, et l'isolation des accès serveur entre projets n'est pas démontrée.

Le code local audité n'est pas une preuve que la même version est déjà déployée en production.

## Données réellement lues

Inventaire en lecture seule de 193 enregistrements `rh-pointage-*` : 1 pointage courant et 192 archives. Parmi les archives, 99 portent `cleared: true` et 93 contiennent encore un payload actif. Les lectures paginées ne constituent pas une transaction figée : une modification concurrente reste possible.

Le courant lu a la révision **2026-10-13T12:43:23.763843+00:00**, contient **337 pointages bruts**, et utilise une pause de **30 minutes** :

- 12 octobre : 231 pointages bruts.
- 13 octobre : 106 pointages bruts.

Ce sont des événements de pointeuse, pas des nombres d'employés ni des journées complètes garanties. La précédente lecture à 329 pointages et pause 0 est dépassée.

Sur la période du 26 septembre au 13 octobre : **17 dates sur 18 possèdent des pointages dans le courant ou les archives**. Les 15 dates du 26 septembre au 10 octobre existent dans les archives. Aucun 11 octobre n'a été trouvé dans les pointages bruts, les lignes journalières ni les en-têtes source des archives accessibles après normalisation. Cette absence de données ne prouve pas une absence des salariés : il peut manquer un export ou s'agir d'un jour non travaillé.

Les payloads JSON sérialisés des 193 enregistrements représentent **97 747 912 octets**, soit environ **97,75 Mo**. Le courant représente **542 354 octets**, soit environ **0,54 Mo**. Ces mesures ne sont ni la taille physique PostgreSQL, ni l'espace restant, ni la taille des autres projets. Les archives répliquent des données : additionner leurs événements ne donne pas un nombre de pointages uniques.

Le plan de rétention, uniquement préparé, classe 40 enregistrements à conserver, 134 candidats à suppression (dont 99 déjà vides), 16 à examiner pour dates anciennes et 3 contenant plusieurs périodes à traiter séparément. **Aucune suppression exécutée.** Une suppression SQL ne garantit pas une baisse immédiate de la taille physique des fichiers de la base.

## Fonctionnement de l'import

1. `DailyPointageImport.jsx` reçoit le fichier Excel et transmet les employés de référence, le snapshot précédent et les règles de pause.
2. `pointageImport.js` lit les feuilles reconnues, identifie les colonnes de pointeuse, préserve les cellules source et rejette les lignes invalides. La déduplication est activée.
3. La correspondance salarié privilégie les matricules ZK, puis les autres identifiants. Un matricule inconnu n'est pas silencieusement remplacé par une correspondance de nom. Les doublons ambigus sont signalés à vérifier.
4. Les événements sont regroupés par salarié et date. Pour un nombre pair de pointages, le calcul prend la dernière heure moins la première, retranche la pause et arrondit. Pour un nombre impair, les heures calculées sont nulles et le statut est à vérifier.
5. `mergeDailyPointage` conserve les autres dates du cycle et remplace entièrement les dates présentes dans le nouvel import. Un changement de cycle, déterminé par la dernière date, repart sur le nouveau fichier.
6. `pointageSnapshotStore.js` normalise, compacte les copies identiques, écrit le courant sous contrôle de révision, relit pour vérifier puis écrit l'archive séparément.
7. Le tableau et l'export filtrent du 26 à aujourd'hui. Les dates non importées restent vides. L'affichage se construit avec la base salariés actuelle, qui fournit noms, services, catégories, statut et date d'embauche : ce n'est pas une copie visuelle brute du fichier.

## Corrections validées et limites

### Dates

Le contrat source version 9 est `mdy-visible-v1` : `10/01/2026` signifie 1er octobre dans l'export attendu, et s'affiche `01/10/2026` en français. Les formats Excel numériques, les dates ISO et les sources historiques passent par une normalisation commune. Les cellules originales sont conservées pour les réparations ; le nom du fichier ne décide pas de la date.

Les tests couvrent sauvegarde, rechargement, recalcul de pause et protection contre un ancien snapshot. Ce contrat est spécifique aux exports de cette pointeuse : un autre fichier réellement français jour/mois, surtout avec des jours inférieurs à 13, peut être interprété à tort s'il est importé sans distinction. Il ne faut pas présenter cet importeur comme universel.

### Timeout de sauvegarde

Les deux gros snapshots ne sont plus envoyés dans un seul upsert. La copie `currentFilePointage` est compactée seulement lorsqu'elle reproduit exactement les champs racine, puis reconstruite à la lecture. Les tests vérifient l'intégrité et les conflits de révision.

Si l'archive échoue après la sauvegarde du courant, l'application le signale ; il n'y a pas de transaction atomique couvrant les deux écritures. Un futur timeout reste possible avec de gros volumes. Cet audit n'a pas rejoué de sauvegarde réelle pour tester le timeout, conformément à son périmètre en lecture seule.

### Courbe et calendrier

Les trois onglets sont restaurés. La courbe combine moyennes mensuelles, moyennes hebdomadaires et jours de la semaine ; quatre points ne signifient pas quatre jours importés. Les valeurs manquantes ne sont pas inventées.

Le tableau suit le cycle 26–25, mais le composant de courbe regroupe encore les mois civils. Il reçoit seulement l'historique du cycle affiché, pas trois mois complets d'archives. Les intitulés « 3 mois » et « Mois actuel » ne garantissent donc pas trois mois complets ni une moyenne exacte du cycle 26–25. La documentation `pointage-storage.md` décrit encore une courbe quotidienne et doit être actualisée.

## Problèmes et risques à traiter

### Priorité haute — conservation et réimport

- Le courant contient uniquement les 12 et 13 octobre. Les journées archivées ne sont pas automatiquement réintégrées au chargement. Leur absence à l'écran n'est pas leur disparition de Supabase.
- Un réimport partiel remplace **tous les événements déjà présents sur ses dates**, pas seulement les salariés inclus dans le nouveau fichier. Un export de 10 salariés sur une date précédemment complète peut donc retirer les autres salariés de cette date dans le courant.
- Le cycle est comparé avec la date maximale. Les lignes hors cycle d'un fichier couvrant plusieurs périodes ne sont pas toutes filtrées avant sauvegarde. Le premier import est également accepté sans ce filtrage. Le test contenant avril et septembre montre qu'une date ancienne peut rester stockée. Le filtre d'écran ne remplace pas une règle de conservation en base.
- Les archives sont des snapshots complets et peuvent être mises à jour avec le même importId lors des corrections. Ce ne sont pas un journal immuable de toutes les versions.

### Priorité haute — absences et effectifs

- Les ABS explicites et certains congés sont masqués si la date d'embauche est absente. Deux tests reproduisent la perte d'ABS et l'impossibilité de corriger ensuite cet ABS masqué.
- Des salariés actifs ayant une date d'embauche sont ajoutés depuis l'annuaire même sans pointage. Cela explique une différence possible entre « employés du fichier » et effectif affiché. Les deux tests navigateur constatent 4 personnes au lieu des 3 attendues selon leur ancienne règle.
- Le calcul des blancs en ABS ne vérifie pas systématiquement `closedDates` dans `buildDailyWeeks`/`buildDailyTable`. Une journée importée encore en cours peut produire des ABS pour les salariés qui n'ont pas encore pointé. En revanche, une journée totalement non importée reste vide grâce au calendrier.
- La base salariés actuelle est réutilisée lors des recalculs. Un changement de statut ou de catégorie peut modifier l'affichage historique sans modification des événements bruts.

### Priorité haute — isolation des projets

Les écritures normales du pointage ciblent `hr_dashboard_store` et les identifiants RH prévus. Les 25 tests SQL incluent la conservation des payloads et horodatages sans rapport avec le pointage. Les tests navigateur simulent aussi des enregistrements protégés.

Cela vérifie le périmètre du code, pas les droits réels de toute la base. Le fichier `supabase-schema.sql` accorde à `anon` et `authenticated` des accès larges (`using (true)` / `with check (true)`) sur les tables RH. Si ces politiques sont installées telles quelles, elles ne cloisonnent pas les lignes par projet. Le code de confirmation RH côté navigateur n'est pas une autorisation serveur.

Autre fonction à distinguer du pointage : `clearEmployeeDirectory` peut vider toute la table `hr_staff_directory`, par lots sans filtre de projet. Si plusieurs applications utilisent cette même table, cette action aurait un effet partagé. Elle n'a pas été exécutée. Les politiques effectives et les dépendances entre applications restent à inventorier avant toute modification de sécurité.

### Calculs à documenter

- Avec quatre passages 08:00, 12:00, 13:00, 17:00 et pause 0, le calcul actuel donne 9 heures, pas la somme des deux créneaux de 8 heures. C'est une règle première/dernière heure, à valider pour les sorties intermédiaires.
- Les statuts à vérifier comptent comme présents dans les indicateurs, même lorsque les heures calculées sont nulles.
- Le seuil de retard est fixé à 07:30. Les corrections manuelles refusent une sortie antérieure à l'entrée et ne gèrent pas un poste traversant minuit.
- La pause peut être recalculée et sauvegardée automatiquement au chargement selon les paramètres du navigateur. Le contrôle de révision protège contre un écrasement concurrent, mais le simple chargement de l'application n'est pas toujours une opération en lecture seule.

## Vérifications exécutées

- Compilation de production : réussie. Avertissement de taille du bundle JavaScript, environ 1,12 Mo avant compression.
- Tests unitaires : **105 réussis / 111**, donc 6 échecs.
- Tests SQL locaux : **25 réussis / 25**. Cela ne prouve pas l'installation actuelle du trigger en production.
- Tests navigateur import/dates/stockage/source : **17 réussis / 19**, donc 2 échecs sur le même écart d'effectif, aux largeurs 1500 et 390 px.

Détail des six échecs unitaires : deux attentes de remplacement intégral incompatibles avec l'accumulation ; un cas de conservation d'une date hors période ; deux cas liés aux ABS sans date d'embauche ; un test d'embauche qui ne s'exécute pas car son helper `workbookFile` est absent. Ce dernier est un défaut du test, pas une preuve d'erreur du calcul d'embauche.

Les mocks des deux anciens tests navigateur supposent encore l'ancien format d'écriture et doivent aussi être mis à jour avant de servir de validation complète du nouveau stockage. Les tests dédiés au stockage conditionnel, eux, réussissent.

## Ordre de correction proposé

1. Reconstituer le mois depuis les archives fiables en conservant les données récentes et les corrections, sous contrôle de révision. Rechercher l'export original du 11 octobre s'il devait être travaillé.
2. Distinguer import complet d'une journée et complément partiel, puis appliquer réellement la limite 26–25 aux données conservées.
3. Stabiliser les règles d'absence, de journée ouverte et d'effectif ; mettre les tests en cohérence sans supprimer les contrôles utiles.
4. Clarifier les périodes et libellés de la courbe pour conserver son aspect demandé avec des calculs compréhensibles.
5. Vérifier les politiques RLS effectives et les tables partagées, puis préparer une isolation compatible avec les autres applications.
6. Nettoyer uniquement les archives de pointage admissibles après sauvegarde et reconstitution. Mesurer ensuite la taille réelle via les outils administrateur Supabase.

Les constats et ce plan ne constituent pas une correction appliquée. Aucun comportement métier ni donnée serveur n'a été modifié pendant cet audit.
