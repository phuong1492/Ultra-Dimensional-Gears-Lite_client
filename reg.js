//var os = require('os');//for ip reporter
//var	fs = require('fs');
var fs = require('fs-extra');
var childProcess = require('child_process');//for initiate DB, exec init_db.js
//to upload configs and unzip them
var formidable = require('formidable');
var unzip = require('unzip2');

//load installed configs
var configs_path = "./configs"
var configs_list = fs.readdirSync(configs_path);
console.log("Config Settings: ");
console.log(configs_list);
console.log("Are Detected...")

//create temp folder for upload
if (fs.readdirSync('./').indexOf('temp')===-1) {
  fs.mkdir('./temp', '0755',
    function (err) {
      if (err) {console.log(err);return;}
      console.log('Temp Directory Created');
    }
  );
}

//DB
var sqlite3 = require('sqlite3');
var db_flag = fs.readdirSync('./').indexOf('client_db.sqlite3')===-1?false:true;
if (db_flag) {
  connect_db();//if db exsit,try to connect
}else{
  init_db();//else exec init_db.js to create one
}
var io_wait_time = 100;//wait for db ready
var db;
var sql_get_table_name = "SELECT name FROM sqlite_master WHERE type='table' AND name!='sqlite_sequence' order by name";
var sql_instr_tab = "SELECT * FROM instrument_table ORDER BY id DESC";
var sql_raw_data = "SELECT * FROM data_table ORDER BY id DESC";
var sql_add_instr = "INSERT INTO instrument_table (instr_name, mac_addr, config) VALUES(?, ?, ?)";
var sql_del_instr = "DELETE FROM instrument_table WHERE id = ?;";


//for http server
var	express = require('express'),
    app = express();
//router very very important
var index_router = express.Router();

//set ejs as view
app.set('view options', { layout: false });
app.set('view engine', 'ejs');
var port = 8888;
app.listen(port);

index_router.get('/', function(req, res, next) {
  var ini_json = load_ini_json();
  var disable = ini_json.dev_name?"":"disabled";//confirm if have ini.json
  res.render('index', {
  						title: ini_json.dev_name || 'New Device',
  						disable: disable ||'true' ,
              uuid: ini_json.uuid || get_uuid(),
              server_url: ini_json.server_url || "http://localhost/",
              org: ini_json.org || 'Unknow.Org',
              dev_name: ini_json.dev_name || '',
              mail: ini_json.mail || '',
              password: ini_json.password || 'password'});
});

//render index page defalt
app.use('/', index_router);
//render set db page
app.use('/set_db', function(req,res){
  //reload ini.json for setting db
  var ini_json = load_ini_json();
  //reload configs_list if user add new plugs
  configs_list = fs.readdirSync(configs_path);

  //and render set_db page if ini.json completed
  if (ini_json.dev_name&&db_flag) {
    //try to connect db
    connect_db();
    var instr_data = [{Error: "Database Error!"}];//if DB err
    var raw_data = instr_data;
    //access db
    db.all(sql_instr_tab,function(err,res){
      instr_data = res;
      if (res.length===0) {instr_data=[{},{"No Data": "No Data to View."}]};
      if (err){
          instr_data =[{Error: err}] ;//avoid view error
      };
    });
    db.all(sql_raw_data,function(err,res){
      raw_data = res;
      if (res.length===0) {raw_data=[{"No Data": "No Data to View."}]};
      if (err) {raw_data=[{Error: err}] };
    });
    // waitting for io ready
    setTimeout(function(){
      //console.log(db_data);
      res.render('set_db', {
        title: ini_json.dev_name,
        instr_data: instr_data ,
        raw_data:raw_data,
        configs_list:configs_list}
    );},io_wait_time);
  }else{
    res.render('jump_page',{
      title: "Not Initiated Device",
      title_next:"Initiating",
      msg:"Whoops! You seems have not regsitered..",
      disabled:"",
      jump_time: 3000,
      href: "./"
    });
  }
});

//when get data from index jump to confirm_set.ejs
app.get('/reg_div', function(req, res){
  console.log(req.query); // for logging
  if (req.query) {  //if not null
  	//write ini.json
    fs.writeFile('ini.json',
    	JSON.stringify(req.query,null,' '),
    	function(err){
        if (err) {
          console.log(err);
          res.send(err);return;
        };
        //reload ini.json for confirm page
        var ini_json = load_ini_json();
        //and render  page
        var disable = ini_json.dev_name?"":"disabled";
        res.render('confirm_set', { title: ini_json.dev_name,
                                    disable: disable,
                                    data: ini_json } );
        //init_db();//when regsitered , init DB
      });
  }else{
    //app.use('/', router);//render index page
  }
});
//confirm added instrument
app.get('/add_instr',function(req,res){
  var title= "",msg = "";
  var jump_time = req.query.jump_time;
  if (req.query) {
    //console.log(req.query);
    db.run(sql_add_instr, req.query.instr_name, req.query.mac_addr, req.query.config, function(err){
      if (err) {
        console.log(err ); msg = "Error:"+err; jump_time = 15000; title="Database Error";
      }else{
        //must wait io ready
        title = req.query.instr_name+" Added";
        msg = "New Instrument [ "+req.query.instr_name+" ] Added.";
      }   //console.log(req.query);
    });
  };
  //wait db io ready
  setTimeout(function(){
    //console.log(title);
    console.log(msg);
    res.render('jump_page', {
          title: title,
          title_next: req.query.title_next,
          jump_time: jump_time,
          href: req.query.href,
          disabled:"",
          msg:msg } );
  },io_wait_time);
});
//confirm deleted instrument
app.get('/del_instr',function(req,res){
  if (req.query) {
    //console.log(req.query);
    db.run(sql_del_instr, req.query.instr_id, function(err){
      if (err) {console.log(err);res.send(err);return;};
      console.log("Instrument [ "+req.query.title+" ] id:"+req.query.instr_id+" Deleted");
    });
  };
  res.render('jump_page', {
        title: req.query.title+" Deleted",
        title_next: req.query.title_next,
        jump_time: req.query.jump_time,
        href: req.query.href,
        disabled:"",
        msg:req.query.msg } );
})
//jump_page from confirm_set.ejs to set_db.ejs
app.get('/to_edit_db', function(req, res){
  if (req.query) {
    res.render('jump_page', { title: req.query.title,
                              title_next:req.query.title_next,
                              jump_time: req.query.jump_time,
                              href: req.query.href,
                              disabled:"",
                              msg:req.query.msg } );
  };
});

//show edit config page
app.use('/upload_page',function(req,res) {
  //reload configs_list if user add/remove new plugs
  configs_list = fs.readdirSync(configs_path);
  res.render('upload_page', { configs_list:configs_list } );
})
//upload config and uzip
app.post('/upload_conf',function(req,res) {
  var form = new formidable.IncomingForm();
  form.encoding = 'utf-8';
  form.uploadDir = './temp';
  form.keepExtensions = true;
  form.maxFieldsSize = 10 * 1024 * 1024;
  form.parse(req, function (err, fields, files) {
    if(err) {res.send(err);console.log(err);return;}
    //toLowerCase() will be safe
    var file_name=files.config_file.name.split(".")[0].toLowerCase();
    var path_to = configs_path+"/"+file_name+"/";
    var extract = unzip.Extract({ path:  path_to }); //out path
    extract.on('error', function(err) {
        res.send(err);
        console.log(err);
    });
    extract.on('finish', function() {
        console.log("Config [ "+file_name+" ] Installed!");
        //delete temp files
        var temp_files=fs.readdirSync(form.uploadDir);
        temp_files.forEach(function(temp) {
          fs.unlink("./temp/"+temp,function(err) {
            if(err){res.send(err);console.log(err);return;}
          //console.log("Temp Files "+temp+" Removed")
        });
      });
    });
    var path_from =  files.config_file.path;
    fs.createReadStream(path_from).pipe(extract);
    //jump to set_db
    res.render('jump_page', { title: "Config "+file_name+" Created",
                              title_next:"Edit Configs",
                              jump_time: 3000,
                              href: "/upload_page",
                              disabled:"",
                              msg:"Config "+file_name+" Created Successfuly.." } );;
  });
})
//delete config
app.get('/del_conf',function(req,res) {
  fs.remove(configs_path+'/'+req.query.config_name, function (err) {
  if (err){console.error(err);res.send(err); return }
  console.log('Config [ '+req.query.config_name+' ] Deleted');
  res.render('jump_page', {
        title: req.query.title+" Deleted",
        title_next: req.query.title_next,
        jump_time: req.query.jump_time,
        href: req.query.href,
        disabled:"",
        msg:req.query.msg } );
  });
});

app.get('/exit',function(req,res){
  try{
    var package_json = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
  }catch(e){
    var package_json = { };
  }
  res.render('jump_page', { title: "~ Admin Process Exiting ~",
                              title_next:package_json.name||"Google",
                              jump_time: req.query.jump_time||3000,
                              href: package_json.homepage||"http://www.google.com",
                              disabled:"disabled",
                              msg:"Ending Admin Process, Thank You For Using... " } );
  console.log("------ Admin Process Shuting Down... ------");
  //setTimeout(function() {
    process.exit();
  //},req.query.jump_time);
})

//get local ip address and tell user
console.log("Please connect to :");
var ip_reporter = require('./dg_modules/ip_reporter');
ip_reporter(port);
/*
var ifaces = os.networkInterfaces();
Object.keys(ifaces).forEach(function (ifname) {
  var alias = 0;
  ifaces[ifname].forEach(function (iface) {
    if ('IPv4' !== iface.family || iface.internal !== false) {
      // skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
      return;
    }
    if (alias >= 1) {
      // this single interface has multiple ipv4 addresses
      console.log(ifname + alias, iface.address + ':' + port);
    } else {
      // this interface has only one ipv4 adress
      console.log(ifname, iface.address+ ':' + port);
    }
    ++alias;
  });
});*/

function get_uuid(){
  var now = new Date();
  var uuid = now.toISOString();
  var rad = Math.random().toString(16);
  uuid += rad.substr(2,4);
  return uuid;
}

//find if have ini.json
function load_ini_json(){
  try{
    var ini_json = JSON.parse(fs.readFileSync('./ini.json', 'utf8'));
  }catch(e){
    var ini_json = { };
  }
  return ini_json;
}

function init_db(){
  var child = childProcess.fork('./init_db.js');
  child.on('message',function(msg){
    console.log("Making Database:"+msg );
  });
  child.on('close',function(code){
    console.log("Database Maker Ended :"+code);
    db_flag=true;
  });
}

function connect_db(){
  db = new sqlite3.Database('client_db.sqlite3',sqlite3.OPEN_READWRITE,function (err) {
    if (err) {
      console.log(err);
    }
  });//if write sqlite3.OPEN_READWRITE db will not create auto
}
