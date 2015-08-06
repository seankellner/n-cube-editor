package com.cedarsoftware.util

import com.cedarsoftware.ncube.ApplicationID
import com.cedarsoftware.ncube.Axis
import com.cedarsoftware.ncube.AxisType
import com.cedarsoftware.ncube.AxisValueType
import com.cedarsoftware.ncube.CommandCell
import com.cedarsoftware.ncube.NCube
import com.cedarsoftware.ncube.StringUrlCmd
import com.cedarsoftware.util.io.JsonReader
import groovy.transform.CompileStatic
import org.apache.logging.log4j.LogManager
import org.apache.logging.log4j.Logger

import javax.servlet.http.HttpServletRequest
import javax.servlet.http.HttpServletResponse

/**
 * Spring Transaction Based JDBC Connection Provider
 *
 * @author Raja Gade
 *         <br/>
 *         Copyright (c) Cedar Software LLC
 *         <br/><br/>
 *         Licensed under the Apache License, Version 2.0 (the "License");
 *         you may not use this file except in compliance with the License.
 *         You may obtain a copy of the License at
 *         <br/><br/>
 *         http://www.apache.org/licenses/LICENSE-2.0
 *         <br/><br/>
 *         Unless required by applicable law or agreed to in writing, software
 *         distributed under the License is distributed on an "AS IS" BASIS,
 *         WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *         See the License for the specific language governing permissions and
 *         limitations under the License.
 */
@CompileStatic
class ProxyRouter
{
    private static final Logger LOG = LogManager.getLogger(ProxyRouter.class);

    /**
     * Route the given request based on configured routing within n-cube
     */
    public void route(HttpServletRequest request, HttpServletResponse response)
    {   // use n-cube
        Map<String, String[]> requestParams = request.getParameterMap()
        if (!requestParams.containsKey('appId'))
        {
            String msg = '"appId" parameter missing - it is required and should contain the ApplicationID fields app, verison, status, branch in JSON format.'
            LOG.error(msg)
            throw new IllegalArgumentException(msg)
        }
        try
        {
            Map<String, String> appParam = JsonReader.jsonToMaps(requestParams.appId[0])
            ApplicationID appId = new ApplicationID(ApplicationID.DEFAULT_TENANT, (String)appParam.app, (String)appParam.version, (String) appParam.status, (String) appParam.branch)
            NCube finder = new NCube('router')
            finder.setApplicationID(appId)
            Axis find = new Axis('dontcare', AxisType.DISCRETE, AxisValueType.STRING, true, Axis.DISPLAY, 1)
            finder.addAxis(find)
            // What URL goes here?
            String url = request.getRequestURL().toString()
            CommandCell cmd = new StringUrlCmd(url, false)
            finder.setCell(cmd, [dontcare: null])
            finder.getCell([:])

        }
        catch (Exception e)
        {
            String msg = '"appId" parameter not parsing as valid JSON: ' + requestParams.appId
            LOG.error(msg, e)
            throw new IllegalArgumentException(msg, e)
        }


    }
}