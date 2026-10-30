// Official 2025–26 mountain statistics; camera targets are mid-mountain, not summits.
export const mountains = [
 {id:'snowmass',name:'Snowmass',summit:12510,vertical:4440,runs:98,lon:-106.965,lat:39.190,height:3200,range:11000,tag:'A whole world of terrain'},
 {id:'buttermilk',name:'Buttermilk',summit:9900,vertical:2030,runs:44,lon:-106.874,lat:39.194,height:2750,range:6500,tag:'Room to find your rhythm'},
 {id:'aspen-highlands',name:'Aspen Highlands',summit:12392,vertical:3635,runs:144,lon:-106.867,lat:39.151,height:3200,range:8500,tag:'Ridges, steeps, and the Bowl'},
 {id:'aspen-mountain',name:'Aspen Mountain',summit:11262,vertical:3317,runs:127,lon:-106.822,lat:39.162,height:2900,range:7200,tag:'The mountain above town'}
];
export const difficulty = {
 novice:{symbol:'●',label:'Beginner',color:'#40bc82',dash:true},
 easy:{symbol:'●',label:'Easy',color:'#40bc82',dash:true},
 intermediate:{symbol:'■',label:'Intermediate',color:'#39a9ff'},
 advanced:{symbol:'◆',label:'Advanced',color:'#182338'},
 expert:{symbol:'◆◆',label:'Expert',color:'#182338'},
 extreme:{symbol:'◆◆',label:'Extreme',color:'#182338'},
 freeride:{symbol:'◆◆',label:'Freeride / extreme',color:'#182338'},
 unknown:{symbol:'?',label:'Unrated',color:'#b3a4cf'}
};
export const getDifficulty = value => difficulty[value] || difficulty.unknown;
