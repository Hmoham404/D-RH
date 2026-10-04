# STC à la date sélectionnée

Le compteur, les listes STC et les indicateurs de production utilisent la même
date sélectionnée. Une sauvegarde ou un recalcul de pause conserve cette date.

Une fiche est comptée uniquement si sa date de départ est complète et valide,
dans la période de paie du 26 au 25 contenant la date sélectionnée, et déjà
effective à cette date. Les valeurs vides, zéro et les mois seuls sont exclus.

Exemples :

- Le 1er octobre 2026 : les départs du 29 septembre et du 1er octobre sont
  comptés dans la période du 26 septembre au 25 octobre. Le départ du 2 octobre
  reste masqué.
- Le 2 octobre : ce départ devient visible.
- Le 26 octobre : une nouvelle période commence, du 26 octobre au 25 novembre.
  Les départs des périodes précédentes sont exclus.

## Import et sauvegarde RH

Les dates de la base du personnel sont en jour/mois/année. Une cellule Excel
numérique est décodée depuis sa valeur native, indépendamment de son format
d'affichage. Les systèmes Excel 1900 et 1904 sont pris en charge. Les dates RH
ne passent pas par la règle mois/jour/année des exports de pointeuses.

La colonne `Actif/Inactif` est prioritaire sur un `Statut` générique. La colonne
`Inactif A PARTIR DU` doit fournir la date de départ ; le mot `actif` contenu
dans `inactif` ne doit pas détourner cette colonne vers le statut.

Les dates sont normalisées en `jj/mm/aaaa` avant sauvegarde dans
`hr_staff_directory.inactive_from`, puis normalisées à la lecture Supabase et
du cache local. Aucun changement de schéma SQL n'est nécessaire pour ce calcul.

La lecture de la base Supabase configurée pour ce projet, le 4 octobre 2026,
a trouvé 96 fiches actives dans l'annuaire partagé, dont 42 au statut STC,
sans aucune valeur enregistrée dans `inactive_from`. Le compteur zéro reste
donc cohérent avec la règle tant que les dates du fichier RH ne sont pas
réimportées. Cette vérification n'a modifié aucune donnée distante.

Les dates déjà absentes de Supabase ne peuvent pas être reconstituées depuis un
statut STC. Après déploiement du code corrigé, réimporter le fichier RH original
avec ses dates de départ. Une ancienne date ambiguë telle que `10/1/26` ne peut
pas être réparée de façon certaine sans ce fichier original.

## Vérification

```powershell
node --test src/lib/employeeBaseImport.test.js src/lib/employeeStcPeriod.test.js src/lib/employeeStatus.test.js
npx playwright test tests/ui/stc-dates.spec.js tests/ui/pointage-dates.spec.js --workers=1
npm run build
```

Les tests navigateur simulent les requêtes Supabase : ils vérifient la date
sélectionnée, les cartes, la liste, les bornes 26–25, la sauvegarde RH puis le
rechargement. Ils n'écrivent pas dans la base réelle.

La suite générale conserve six échecs unitaires préexistants dans les tests
d'historique, d'absence et de correction du pointage. Ces échecs ont aussi été
reproduits depuis les fichiers du commit HEAD avant les modifications STC,
dans `.pointage-backups/stc-baseline`. Deux anciens tests navigateur
`pointage-source.spec.js` échouent également sur l'effectif (4 au lieu de 3).
Les suites ciblées RH/STC, dates du pointage, sauvegarde et SQL passent.
