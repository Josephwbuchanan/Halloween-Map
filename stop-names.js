export const STOP_NAMES = [
  'The Pumpkin Porch','Candy Corner','The Haunted Garden','Boo & Brews','The Witching Hour',
  'The Ghostly Gate','The Spooky Stoop','The Candy Cauldron','The Skeleton Stop','The Bat Cave',
  'The Moonlit Manor','The Cobweb Cottage','The Goblin Garage','The Friendly Phantom','The Treat Retreat',
  'The Pumpkin Patch','The Boo Crew','The Monster Mash','The Midnight Munchies','The Haunted Hideaway',
  'The Candy Crypt','The Witch’s Welcome','The Ghost Host','The Spooky Snack Shack','The Grinning Gargoyle',
  'The Pumpkin Palace','The Trickster’s Treats','The Batty Bungalow','The Cozy Cauldron','The Howling House',
  'The Candy Castle','The Lantern Landing','The Mummy’s Munchies','The Frightful Front Door','The Specter’s Steps',
  'The Sugar Spell','The Twilight Treats','The Happy Haunting','The Cackling Cottage','The Wicked Welcome',
  'The Boo-tiful Porch','The Candy Coven','The Ghoulish Gathering','The Spooky Sparkle','The Moonlight Morsels',
  'The Pumpkin Pit Stop','The Treat Trove','The Phantom Pantry','The Witch’s Window','The Graveyard Goodies',
  'The Monster’s Munch','The Glowing Gateway','The Candy Carousel','The Black Cat Corner','The Haunted Hearth',
  'The Spooky Sprinkles','The Boo Boulevard','The Trick-or-Treat Terrace','The Pumpkin Parade','The Friendly Fright',
  'The Cobweb Corner','The Giggling Ghost','The Candy Cabin','The Spooky Sweets','The Lantern Lodge',
  'The Skeleton’s Smile','The Moonlit Munch','The Wobbly Witch','The Treat Trail','The Phantom Porch',
  'The Pumpkin Party','The Boo Basket','The Candy Carnival','The Batty Backyard','The Ghostly Glow',
  'The Witch’s Whimsy','The Monster Manor','The Creepy Candy Shop','The Haunted Hangout','The Midnight Magic',
  'The Pumpkin Perch','The Sugar Skeleton','The Spooky Surprise','The Cauldron Corner','The Boo Barn',
  'The Treat Trolley','The Ghostly Goodies','The Candy Conjurer','The Bat Wing Bistro','The Moonbeam Mansion',
  'The Hocus Pocus House','The Jack-o’-Lantern Junction','The Charmed Chimney','The Spellbound Steps','The Candy Cobweb',
  'The Pumpkin Picnic','The Boo Bonanza','The Witch’s Wagon','The Friendly Fiend','The Last Laugh Lantern'
];
export function pickStopName(existingNames = [], random = Math.random) {
  const used = new Set(existingNames.map(n=>String(n).trim().toLowerCase()));
  const available = STOP_NAMES.filter(n=>!used.has(n.toLowerCase()));
  const pool = available.length ? available : STOP_NAMES;
  const base = pool[Math.floor(random()*pool.length)];
  if(available.length)return base;
  let number=2;
  while(used.has(`${base} ${number}`.toLowerCase()))number++;
  return `${base} ${number}`;
}
