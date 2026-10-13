# Sauvegarde du pointage

Les imports enregistraient deux snapshots complets dans un seul `upsert`.
Sur les données réelles de 2 380 pointages, la requête historique dépassait
`statement_timeout`, y compris après séparation des écritures.

Le client utilise maintenant une mise à jour conditionnelle du pointage courant,
vérifie les données relues, puis écrit l'historique séparément. L'échec de
l'historique est signalé sans masquer la sauvegarde du pointage courant et sans
supprimer l'ancien historique. Une révision concurrente interrompt l'import.

Lorsque `currentFilePointage` est une projection exactement identique des champs
du snapshot parent, `compactPointageStorage` conserve les données au niveau racine
et remplace la copie par `currentFilePointage: null` et une liste
`currentFilePointageParentFields`. `expandPointageStorage` reconstitue tous les
champs à l'identique avant normalisation et comparaison des dates. Un sous-ensemble
différent conserve le format complet. Les contrôles SQL existants continuent de
valider les cellules source conservées à la racine.

Cette représentation a réduit chaque requête réelle de 5,57 Mo à 3,07 Mo.
Aucune migration SQL ni augmentation globale du délai n'est nécessaire.
Recharger les anciens onglets après déploiement : les anciens clients ne savent
pas développer la représentation compacte. Avant un retour à un ancien client,
développer les payloads compacts avec `expandPointageStorage` ou restaurer une
sauvegarde complète appropriée en vérifiant les révisions.

Vérifications :

```sh
node --test src/lib/pointageStorage.test.js src/lib/pointageSnapshotDates.test.js
npm run test:sql
npx playwright test tests/ui/pointage-store.spec.js
npm run build
node scripts/verify-pointage-storage.mjs
```

`node scripts/verify-pointage-storage.mjs --write-existing` réenregistre les mêmes
données réelles par le service applicatif, avec contrôle de révision et sauvegarde
préalable dans `.pointage-backups/timeout-verification-*.json`. Il vérifie ensuite
le pointage courant et son historique. Sans cette option, il reste en lecture seule.

La suite générale présente six échecs déjà reproduits sur le commit de départ,
concernant le remplacement/accumulation des jours, les ABS et les dates d'embauche.
Ils sont indépendants du correctif de stockage.

## Affichage du mois de paie courant

L'écran de pointage filtre les journées sur la période du 26 au 25 qui contient
la date du jour. Le tableau, la courbe et l'export Excel affichent les dates du
26 jusqu'à aujourd'hui ; les journées non importées restent vides, sans absence calculée.
Les indicateurs et le choix d'une journée utilisent uniquement les dates importées
du mois courant. Le 26, l'affichage passe à la période suivante sans effacer les
données précédentes dans Supabase.

Ce filtre est appliqué à l'affichage uniquement : le snapshot complet reste la
source des imports et des corrections. Il ne lance aucune migration SQL et ne
supprime aucun historique. Les mutations du service pointage ciblent uniquement
`hr_dashboard_store` avec l'identifiant exact `rh-pointage-analysis` ou les
identifiants `rh-pointage-history-*`. Le vidage du pointage courant ne supprime
pas l'historique. Les enregistrements `rh-homepage`, `rh-bus-capacities`, ceux des
autres projets et les autres tables ne font pas partie de ces opérations.

Les tests `pointagePeriod.test.js` et `pointage-dates.spec.js` couvrent les limites
26/25, le changement de mois, les journées non importées et la conservation des
enregistrements extérieurs au pointage pendant un import et un vidage simulés.
Cette isolation des requêtes applicatives ne modifie pas les droits d'accès RLS
des autres applications de la base partagée.

## Nettoyage demandé des pointages hors période

Le nettoyage n'est pas exécuté au chargement de l'application. Le script
`scripts/pointage-retention.mjs --scan --today YYYY-MM-DD` prépare un inventaire
et une sauvegarde complète des seuls enregistrements de pointage. Il ne modifie
pas la base. Le plan conserve toute archive contenant des jours du mois courant,
y compris les archives nécessaires à une récupération des journées manquantes.

L'option `--apply PLAN_FILE --today YYYY-MM-DD` supprime seulement les identifiants
exacts entièrement hors période ou les archives déjà vides. Chaque suppression
est conditionnée par la révision sauvegardée, puis vérifiée. Les payloads mêlant
plusieurs périodes et les dates anciennes ambiguës sont laissés en attente de
traitement séparé. Sans droit DELETE, le script s'arrête ; il ne remplace pas une
suppression refusée par un vidage trompeur, et ne change aucune politique RLS.

À ce stade, le nettoyage et la récupération en base n'ont pas été exécutés :
l'accès distant a été bloqué par une limite d'usage du contrôle d'autorisation.
