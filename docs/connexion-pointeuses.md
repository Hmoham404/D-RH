# Connexion des pointeuses MYC

## Etat de l'integration

Le projet comprend un connecteur local de lecture et un panneau « Connexion aux
pointeuses MYC ». Le site contacte le connecteur de ce PC, qui lit les passages des
trois adresses configurees. Les nouveaux passages suivent ensuite les memes regles
de calcul et de sauvegarde Supabase que les imports Excel. Les imports Excel restent
disponibles. Le code doit etre deploye sur Vercel pour rendre ce panneau disponible
sur la version publiee.

Le 20 octobre 2026, le connecteur a ete installe et teste sur ce PC. La lecture
reelle a retourne 0/3 pointeuses joignables et aucun passage : la connexion physique
de bout en bout n'est donc pas validee. Le Wi-Fi du PC utilise 10.20.32.46/23,
passerelle 10.20.32.254 ; Ethernet est deconnecte. Les tests TCP et UDP sur 4370
vers 10.10.100.201, .202 et .203 expirent. Cela ne determine pas a lui seul
l'origine du blocage ni l'etat des appareils. L'acces au serveur 10.10.30.100 ne
prouve pas l'acces au reseau des pointeuses.

## Demarrage du connecteur sur le PC MYC

```powershell
npm run pointeuses:setup
npm run pointeuses:start
```

Python 3 et Node.js doivent etre disponibles. L'installation du lecteur `pyzk`
version 0.9 reste dans `.pointage-tools/python`, ignore par Git. Le demarrage
ouvre le connecteur en arriere-plan, sans fenetre, et conserve ses journaux dans
`.pointage-tools/logs`. Il ne cree pas de service ni de tache de demarrage Windows.
Pour le garder dans un terminal : `npm run pointeuses:bridge`.

Le serveur ecoute uniquement sur `127.0.0.1:8787`. Il accepte uniquement les
origines declarees dans `siteOrigins`, dont `https://d-rh-hn7b.vercel.app` et
`https://d-rh.vercel.app`, et des
requetes de lecture bornees a 31 jours. Le navigateur peut demander d'autoriser
l'acces au reseau local : cette autorisation concerne ce connecteur. Les tests
navigateur utilisent un autre port et des appareils simules.

Dans le site, « Synchroniser les pointeuses » lance une lecture. La case « Toutes
les 5 min » active les lectures periodiques pendant que la page est ouverte, le
PC allume et le connecteur demarre. Un site ouvert sur un autre PC utilise le
connecteur de cet autre PC ; le serveur Vercel n'a pas d'acces direct aux adresses
privees MYC.

Seuls les nouveaux matricules/heures sont ajoutes. Les doublons, les dates hors
du cycle 26-a-aujourd'hui et les dates futures sont exclus. Une lecture identique
ne reecrit pas le snapshot. Les corrections RH existantes restent prioritaires ;
la synchronisation n'appelle pas l'effacement des corrections utilise par un
reimport Excel manuel. Les revisions Supabase restent controlees lors des ecritures.
Une erreur de lecture ou de sauvegarde ne remplace pas le pointage par des donnees
vides. Si seulement certains appareils repondent, leurs passages peuvent etre
ajoutes, et le panneau indique le nombre d'appareils effectivement lus.

Le lecteur n'exporte ni empreintes, ni noms, ni mots de passe. Il utilise les
fonctions de connexion, lecture du journal et deconnexion ; il n'appelle aucune
suppression, desactivation, reinitialisation ou modification d'heure. `pyzk` est
un client communautaire, pas le SDK officiel ZKTeco : la compatibilite du modele
et la lecture reelle doivent encore etre confirmees une fois le reseau accessible.

Si une pointeuse exige une cle de communication, fournir sa cle au processus
local via `POINTAGE_COMM_KEY_201`, `POINTAGE_COMM_KEY_202` ou
`POINTAGE_COMM_KEY_203` avant de demarrer le connecteur. Ne pas reutiliser un mot
de passe Windows. Les secrets ne vont ni dans le code du site ni dans les variables
`VITE_`. Pour un autre nom de variable, utiliser `communicationKeyEnv` sur l'appareil
dans `config/pointeuses.json`.

## Acces reseau restant a etablir

Verifier depuis ce PC l'acces aux trois adresses et aux ports reellement configures
dans ZKTime.Net. Si le reseau MYC filtre les communications entre segments, le
responsable reseau doit autoriser le trajet de ce PC vers les seuls terminaux et
leurs ports, avec le trafic retour. Une autre possibilite est d'utiliser un poste
ou une prise reseau deja autorises, comme le PC de la capture ZKTime « Connected ».
Ne pas attribuer arbitrairement une adresse 10.10.100.x et ne pas desactiver le
pare-feu : ni le masque/gateway des terminaux ni une adresse libre ne sont verifies.

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

## Verification et evolutions

Les tests locaux du connecteur, du lecteur et de l'import sont disponibles via
`npm run test:pointeuses`, `npm run test:pointeuses:reader` et
`node --test src/lib/pointeuseImport.test.js`. Le parcours navigateur simule est
couvert par `tests/ui/pointeuses.spec.js`, y compris les echecs de sauvegarde et
les appareils non joignables. Ces simulations ne prouvent pas la compatibilite
du materiel reel. Le SDK officiel reste une alternative si le modele n'est pas
compatible avec le lecteur communautaire.

Les donnees ne sont pas stockees durablement dans le connecteur : elles restent
sur les pointeuses jusqu'a une lecture reussie et une sauvegarde du site. Verifier
que les autres logiciels ne les suppriment pas automatiquement apres collecte.

## Documentation fabricant

- [ZKTime.Net 3.0 : reseau et logiciels compatibles](https://zkteco.com.hk/product-detail/zktime-net-3-0/)
- [SDK Standalone officiel](https://github.com/ZKTeco/Standalone-SDK)
- [SDK Standalone : communication TCP/IP par DLL](https://www.zkteco.com.br/produto/sdk-standalone/)
- [Client communautaire pyzk et fonctions de lecture](https://github.com/fananimi/pyzk)
