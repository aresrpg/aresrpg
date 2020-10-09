export function openTrade({ client }) {

  client.on("use_entity", (evt) => {
    console.log(evt)
    if(evt.target=='6917' && evt.mouse==2 && evt.sneaking==false){
      
      const trade = {
        windowId: 1,
        trades: [
          {
            inputItem1: {
              present: true,
              itemId: 581, //https://minecraft-data.prismarine.js.org/?v=1.16&d=items
              itemCount: 1,
            },
            outputItem: {
              present: true,
              itemId: 595,
              itemCount: 1,
            },
            inputItem2: {
              present: true,
              itemId: 581,
              itemCount: 1,
            },
            //tradeDisabled: false,
            //nbTradeUses: 1,
            //maximumNbTradeUses: 1,
            //xp: 1,
            //specialPrice: 1,
            //priceMultiplier: 1.0,
            //demand: 1,
          },
          {
            inputItem1: {
              present: true,
              itemId: 582,
              itemCount: 1,
            },
            outputItem: {
              present: true,
              itemId: 586,
              itemCount: 1,
            },
            inputItem2: {
              present: true,
              itemId: 582,
              itemCount: 1,
            },
          },
        ],
        //villagerLevel: 1,
        //experience: 1,
        //isRegularVillager: false,
        //canRestock: false,
      }

      const window = {
        windowId: 1,
        inventoryType: 18,
        windowTitle: '{"text": "trade"}',
      }
  
      client.write("open_window", window)
      client.write("trade_list", trade)
    }
  })

  client.on("select_trade", console.log)
  client.on("craft_recipe_request", console.log)
}
  

