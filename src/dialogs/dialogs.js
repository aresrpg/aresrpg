export const default_dialog_id = -1

export const mobs = {
  thebes_citizen: {
    // Citoyen de Thebes
    '-1': {
      name: '§a Citoyen §7',
      dialogs: [
        "§fC'est incroyable ce beau temps !",
        "§fC'est toi " +
          'PLAYER_NAME' +
          ' ? je pensais que tu étais plus grand !',
        "§fFais attention à ne pas t'aventurer dans les catacombes, c'est dangereux !",
        "§fJe n'ai pas le temps de te parler, va t'en ou j'apelle la garde !",
        '§fEncore toi ?',
        '§fUn jour les dragons reviendront et ce sera la fin de notre monde !',
        '§fLaisse moi !',
      ],
      linearity: false,
    },
  },
  monk: {
    // Moine
    '-1': {
      name: '§a Moine §7',
      dialogs: [
        '§fA Bien le bonjour étranger !',
        "§fLe père Niflard n'est pas rentré de sa ceuillette de choux..",
        '§fAmen',
        "§fA quelques lieues d'içi se trouve un gouffre terrible remplit d'Arakne.",
        '§fJe doit aller à la messe !',
        '§fUn jour les dragons reviendront et ce sera la fin de notre monde !',
        '§fDiantre ! que tu est vilain..',
        '§fOh !',
        "§fUne bonne cervoise et c'est repartit !",
        '§fHum ?',
      ],
      linearity: false,
    },
  },
  segeste_citizen: {
    // Citoyen de Segeste
    '-1': {
      name: '§a Citoyen §7',
      dialogs: [
        '§fA Ségeste nous aimons la pêche et les belles villageoises !',
        "§fTeh c'est le petit " +
          'PLAYER_NAME' +
          " ! on m'avait dit que tu étais moche mais je ne pensais pas à ce point !",
        '§fOn raconte que le puit de Ségeste est ensorcelé.. sans doute une vieille légende',
        "§fNe m'adresse pas la parole petit ! nous n'avons pas les mêmes valeurs.",
        '§fEncore toi ?',
        '§fUn jour les dragons reviendront et ce sera la fin de notre monde !',
        "§fAAAAAAAAAAAAAAH !!!! Oups pardon je t'avais prit pour un infécté..",
        '§fCe maudit Craken a encore provoqué une inondation...',
        "§fUne bonne bière et c'est repartit !",
        '§fLaisse moi !',
      ],
      linearity: false,
    },
  },
  numen_citizen: {
    // Citoyen de Numen
    '-1': {
      name: '§a Citoyen §7',
      dialogs: [
        '§fO man dôr túliel le ?',
        '§fMan anírach cerin an le ?',
        '§fGwanno ereb nin !',
        '§fNo dhínen !',
        '§fGarich i dhôl goll o Orch',
        '§fNai Aragog meditha le!',
        '§fHeca, firimar !',
      ],
      linearity: false,
    },
  },
}
