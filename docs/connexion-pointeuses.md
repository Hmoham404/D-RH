# Connexion des pointeuses MYC

## Etat de l'integration

L'application RH importe actuellement des fichiers Excel. La synchronisation directe
avec les pointeuses n'est pas encore active. Le diagnostic fourni teste seulement
l'accessibilite TCP des trois adresses visibles dans ZKTime.Net.

## Diagnostic sur le PC MYC

Depuis le dossier du projet :

```powershell
npm run pointeuses:diagnostic
```

Les adresses sont configurees dans `config/pointeuses.json`. Le port 4370 est une
valeur de depart a verifier dans les parametres de chaque terminal de ZKTime.Net.
Le diagnostic n'envoie aucune commande de lecture, suppression ou configuration.
Il retourne le code 1 si au moins une pointeuse ne repond pas.

Un PC connecte au Wi-Fi de l'entreprise peut etre dans un autre sous-reseau que les
pointeuses. Le service informatique doit verifier l'acces entre les deux reseaux,
ainsi que le port reel des terminaux. Un delai d'attente ne permet pas, a lui seul,
de distinguer une mauvaise adresse, un port different, un filtrage ou un appareil eteint.

## Informations pour activer la synchronisation

- Confirmer le modele et le firmware des terminaux dans leurs informations appareil.
- Relever IP et port dans ZKTime.Net et verifier qu'il affiche Connected sur le PC choisi.
- Identifier le PC Windows qui restera connecte au reseau MYC pour la collecte.
- Verifier le SDK compatible avec ces modeles et la cle de communication, si configuree.

## Integration prevue

Un collecteur local utilisera le SDK compatible pour lire les matricules, heures de
passage et terminaux, puis transmettre ces evenements a une table de pointages dediee
dans la base RH. L'application associera les matricules ZK aux employes existants.

Les evenements devront etre dedoublonnes, conserves localement pendant une coupure et
retransmis a la reconnexion. Les heures brutes seront conservees avec le fuseau horaire
du site. Les horaires et regles RH seront necessaires pour calculer absences et retards.
Les identifiants du collecteur devront rester hors des variables VITE exposees au navigateur.

La connexion TCP seule ne suffit pas a valider le protocole ou les calculs de presence.
Aucune modification des terminaux ni de leur contenu n'est necessaire pour cette collecte.

## Documentation fabricant

- [ZKTime.Net 3.0 : reseau et logiciels compatibles](https://zkteco.com.hk/product-detail/zktime-net-3-0/)
- [SDK Standalone officiel](https://github.com/ZKTeco/Standalone-SDK)
- [SDK Standalone : communication TCP/IP par DLL](https://www.zkteco.com.br/produto/sdk-standalone/)
