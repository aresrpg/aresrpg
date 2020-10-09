export function openTrade({ client }) {

  client.on("use_entity", (evt) => {
    
    if(evt.target=='69420' && evt.mouse==2 && evt.sneaking==false){
      
      const trade = {
        windowId: 1,
        trades: [
          {
            inputItem1: {
              present: true,
              itemId: 581,            //https://minecraft-data.prismarine.js.org/?v=1.16&d=items
              itemCount: 1,
            },
            outputItem: {
              present: true,          //https://wiki.vg/Protocol#Trade_List
              itemId: 595,            //https://github.com/PrismarineJS/minecraft-data/blob/master/data/pc/1.16/protocol.json#L2264-L2321
              itemCount: 1,
            },
            inputItem2: {
              present: true,
              itemId: 581,
              itemCount: 1,
            },
            maximumNbTradeUses: 99999, //mandatory
          }
          
        ]
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
}
  

